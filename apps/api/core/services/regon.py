from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Dict, Optional
import logging
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from email import message_from_string

from django.conf import settings


REGON_API_URL = getattr(
    settings,
    "REGON_API_URL",
    "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc",
)
SOAP_NS = "http://www.w3.org/2003/05/soap-envelope"
BIR_NS = "http://CIS/BIR/PUBL/2014/07"


logger = logging.getLogger(__name__)


TYPE_REPORTS = {
    "P": ["PublDaneRaportPrawna"],
    "F": ["PublDaneRaportFizycznaOsoba"],
    "LP": ["PublDaneRaportLokalnaPrawnej"],
    "LF": ["PublDaneRaportLokalnaFizycznej"],
}

PHYSICAL_SILOS_REPORTS = {
    "1": ["PublDaneRaportDzialalnoscFizycznejCeidg"],
    "2": ["PublDaneRaportDzialalnoscFizycznejRolnicza"],
    "3": ["PublDaneRaportDzialalnoscFizycznejPozostala"],
    "4": ["PublDaneRaportDzialalnoscFizycznejWKrupgn"],
}


def _strip_tag(tag: str) -> str:
    return tag.split('}')[-1] if '}' in tag else tag


def _clean_digits(value: Optional[str]) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def _extract_xml_payload(raw_payload: str) -> str:
    stripped = raw_payload.lstrip()
    if stripped.startswith("<"):
        return stripped

    if stripped.startswith("--") and "Content-Type" in stripped[:200]:
        try:
            mime_message = message_from_string(raw_payload)
            payload = mime_message.get_payload()
            if isinstance(payload, list) and payload:
                part = payload[0]
                body = part.get_payload(decode=True)
                if body is not None:
                    return body.decode(part.get_content_charset() or "utf-8", errors="replace")
        except Exception:
            pass

    envelope_markers = ["<?xml", "<soap:Envelope", "<s:Envelope", "<Envelope"]
    start = -1
    for marker in envelope_markers:
        start = raw_payload.find(marker)
        if start != -1:
            break
    if start == -1:
        start = raw_payload.find("<")

    # Find closing MTOM boundary (ends with "--") to avoid including it in XML slice
    closing_boundary = -1
    boundary_pos = 0
    while True:
        pos = raw_payload.find("--uuid", boundary_pos)
        if pos == -1:
            break
        candidate_end = raw_payload.find("\n", pos)
        candidate_line = raw_payload[pos: candidate_end].strip() if candidate_end != -1 else raw_payload[pos:].strip()
        if candidate_line.endswith("--"):
            closing_boundary = pos
            break
        boundary_pos = pos + 1

    search_slice = raw_payload if closing_boundary == -1 else raw_payload[:closing_boundary]
    end = search_slice.rfind(">")
    if start == -1 or end == -1 or end < start:
        raise RegonAPIError("REGON API zwróciło niepoprawną odpowiedź SOAP.")

    return raw_payload[start : end + 1]


class RegonAPIError(Exception):
    """Raised when REGON API could not return the requested data."""


def _build_envelope(body: str, *, soap_action: Optional[str] = None, to_url: Optional[str] = None) -> str:
    header = ""
    if soap_action or to_url:
        header_parts = ["<soap:Header xmlns:wsa=\"http://www.w3.org/2005/08/addressing\">"]
        if soap_action:
            header_parts.append(f"<wsa:Action>{soap_action}</wsa:Action>")
        if to_url:
            header_parts.append(f"<wsa:To>{to_url}</wsa:To>")
        header_parts.append("</soap:Header>")
        header = "".join(header_parts)

    return (
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
        "<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\" xmlns:bir=\"http://CIS/BIR/PUBL/2014/07\">"
        f"{header}"
        "<soap:Body>"
        f"{body}"
        "</soap:Body>"
        "</soap:Envelope>"
    )


@dataclass
class RegonClient:
    api_key: str
    session_id: Optional[str] = None

    def _post(self, action: str, body: str, *, include_sid: bool = False) -> str:
        namespace, soap_action = self._resolve_action(action)
        headers = {
            "Content-Type": "application/soap+xml; charset=utf-8",
            "SOAPAction": soap_action,
        }
        if include_sid:
            if not self.session_id:
                raise RegonAPIError("Brak aktywnej sesji REGON – zaloguj się najpierw.")
            headers["sid"] = self.session_id
        request = Request(
            url=REGON_API_URL,
            data=body.encode("utf-8"),
            headers=headers,
            method="POST",
        )
        logger.info(
            "REGON request",
            extra={
                "action": action,
                "namespace": namespace,
                "url": REGON_API_URL,
                "headers": headers,
                "body": body,
            },
        )
        try:
            with urlopen(request, timeout=10) as response:
                raw_payload = response.read().decode("utf-8", errors="replace")
                payload = _extract_xml_payload(raw_payload)
                logger.info(
                    "REGON response",
                    extra={
                        "action": action,
                        "status": response.status,
                        "headers": dict(response.headers.items()),
                        "body": raw_payload,
                    },
                )
                return payload
        except HTTPError as exc:
            snippet = ""
            try:
                body = exc.read()
                if body:
                    snippet = body.decode("utf-8", errors="ignore").strip()
            except Exception:
                snippet = ""
            detail = f"REGON API HTTP error: {exc}"
            if snippet:
                detail = f"{detail} – {snippet[:500]}"
            logger.error(
                "REGON HTTPError",
                extra={
                    "action": action,
                    "status": exc.code,
                    "reason": exc.reason,
                    "headers": dict(exc.headers.items()) if exc.headers else None,
                    "body": snippet,
                },
            )
            raise RegonAPIError(detail) from exc
        except URLError as exc:
            logger.error(
                "REGON URLError",
                extra={
                    "action": action,
                    "reason": getattr(exc, "reason", None),
                },
            )
            raise RegonAPIError(f"REGON API HTTP error: {exc}") from exc

    def _extract_result(self, payload: str, tag: str) -> Optional[str]:
        ns = {"soap": SOAP_NS, "bir": BIR_NS}
        root = ET.fromstring(payload)
        node = root.find(f".//bir:{tag}", ns)
        return (node.text or "") if node is not None else None

    def login(self) -> str:
        _, soap_action = self._resolve_action("Zaloguj")
        envelope = _build_envelope(
            f"""
            <bir:Zaloguj>
                <bir:pKluczUzytkownika>{self.api_key}</bir:pKluczUzytkownika>
            </bir:Zaloguj>
            """,
            soap_action=soap_action,
            to_url=REGON_API_URL,
        )
        response_xml = self._post("Zaloguj", envelope)
        session_id = self._extract_result(response_xml, "ZalogujResult")
        if not session_id:
            raise RegonAPIError("Nie udało się zalogować do API REGON.")
        self.session_id = session_id
        return session_id

    def logout(self) -> None:
        if not self.session_id:
            return
        _, soap_action = self._resolve_action("Wyloguj")
        envelope = _build_envelope(
            f"""
            <bir:Wyloguj>
                <bir:pIdentyfikatorSesji>{self.session_id}</bir:pIdentyfikatorSesji>
            </bir:Wyloguj>
            """,
            soap_action=soap_action,
            to_url=REGON_API_URL,
        )
        try:
            self._post("Wyloguj", envelope, include_sid=True)
        finally:
            self.session_id = None

    def search_by_nip(self, nip: str) -> Optional[dict]:
        if not self.session_id:
            self.login()
        _, soap_action = self._resolve_action("DaneSzukajPodmioty")
        envelope = _build_envelope(
            f"""
            <bir:DaneSzukajPodmioty>
                <bir:pParametryWyszukiwania>
                    <bir:Nip>{nip}</bir:Nip>
                </bir:pParametryWyszukiwania>
            </bir:DaneSzukajPodmioty>
            """,
            soap_action=soap_action,
            to_url=REGON_API_URL,
        )
        response_xml = self._post("DaneSzukajPodmioty", envelope, include_sid=True)
        raw_result = self._extract_result(response_xml, "DaneSzukajPodmiotyResult")
        if not raw_result:
            return None
        try:
            data_root = ET.fromstring(raw_result)
        except ET.ParseError:
            return None
        record_node = None
        for candidate in data_root.iter():
            if candidate.tag.endswith("dane"):
                record_node = candidate
                break
        if record_node is None:
            return None

        values: Dict[str, str] = {}
        for child in record_node:
            values[_strip_tag(child.tag)] = (child.text or "").strip()

        def get(field: str) -> str:
            return values.get(field, "")

        street = get("Ulica")
        building = get("NrNieruchomosci")
        unit = get("NrLokalu")
        street_parts = [street, building]
        if unit:
            street_parts.append(unit)
        street_value = " ".join(part for part in street_parts if part)

        result = {
            "name": get("Nazwa"),
            "nip": get("Nip"),
            "regon": _clean_digits(get("Regon") or get("Regon14")),
            "city": get("Miejscowosc"),
            "postal_code": get("KodPocztowy"),
            "street": street_value,
            "voivodeship": get("Wojewodztwo"),
        }

        try:
            full_address = self._fetch_full_address(values)
        except RegonAPIError as exc:
            logger.warning(
                "REGON extended address lookup failed",
                extra={"nip": nip, "detail": str(exc)},
            )
            full_address = {}

        for key in ("street", "city", "postal_code", "voivodeship", "country"):
            if full_address.get(key):
                result[key] = full_address[key]
        if full_address.get("address_report"):
            result["address_report"] = full_address["address_report"]

        return result

    def _fetch_full_address(self, record_values: Dict[str, str]) -> Dict[str, str]:
        entity_type = (record_values.get("Typ") or "").upper()
        silos_id = (record_values.get("SilosID") or "").strip()
        report_candidates = self._select_report(entity_type, silos_id)
        if not report_candidates:
            return {}
        regon = self._resolve_regon_for_report(entity_type, record_values)
        if not regon:
            return {}
        for report_name in report_candidates:
            report_node = self._call_report(regon, report_name)
            if not report_node:
                continue
            address = self._address_from_report_node(report_node)
            if address:
                address["address_report"] = report_name
                return address
        return {}

    def _select_report(self, entity_type: str, silos_id: str) -> Optional[list[str]]:
        if entity_type == "F" and silos_id:
            silos_reports = PHYSICAL_SILOS_REPORTS.get(silos_id)
            if silos_reports:
                return silos_reports
        return TYPE_REPORTS.get(entity_type)

    def _resolve_regon_for_report(self, entity_type: str, values: Dict[str, str]) -> Optional[str]:
        regon = _clean_digits(values.get("Regon")) or _clean_digits(values.get("Regon14"))
        if entity_type in {"LP", "LF"} and len(regon) != 14:
            regon_link = values.get("RegonLink") or ""
            match = re.search(r'"(\d{14})"', regon_link)
            if match:
                return match.group(1)
        return regon or None

    def _call_report(self, regon: str, report_name: str) -> Optional[ET.Element]:
        _, soap_action = self._resolve_action("DanePobierzPelnyRaport")
        envelope = _build_envelope(
            f"""
            <bir:DanePobierzPelnyRaport>
                <bir:pRegon>{regon}</bir:pRegon>
                <bir:pNazwaRaportu>{report_name}</bir:pNazwaRaportu>
            </bir:DanePobierzPelnyRaport>
            """,
            soap_action=soap_action,
        )
        response_xml = self._post("DanePobierzPelnyRaport", envelope, include_sid=True)
        raw_result = self._extract_result(response_xml, "DanePobierzPelnyRaportResult")
        if not raw_result:
            return None
        try:
            data_root = ET.fromstring(raw_result)
        except ET.ParseError:
            return None
        for candidate in data_root.iter():
            if candidate.tag.endswith("dane"):
                return candidate
        return None

    def _address_from_report_node(self, node: ET.Element) -> Dict[str, str]:
        values = {_strip_tag(child.tag): (child.text or "").strip() for child in node}

        def find(*suffixes: str) -> str:
            for suffix in suffixes:
                for tag, value in values.items():
                    if tag.endswith(suffix) and value:
                        return value
            return ""

        street_name = find("adSiedzUlica_Nazwa")
        number = find("adSiedzNumerNieruchomosci")
        unit = find("adSiedzNumerLokalu")
        street_parts = [street_name]
        if number:
            street_parts.append(number)
        if unit:
            street_parts.append(unit)
        street_value = " ".join(part for part in street_parts if part)

        return {
            "street": street_value,
            "city": find("adSiedzMiejscowosc_Nazwa", "adSiedzMiejscowoscPoczty_Nazwa"),
            "postal_code": find("adSiedzKodPocztowy"),
            "voivodeship": find("adSiedzWojewodztwo_Nazwa"),
            "country": find("adSiedzKraj_Nazwa"),
        }

    def _resolve_action(self, action: str) -> tuple[str, str]:
        namespace = "IUslugaBIR" if action == "GetValue" else "IUslugaBIRzewnPubl"
        soap_action = f"http://CIS/BIR/PUBL/2014/07/{namespace}/{action}"
        return namespace, soap_action


def lookup_client_by_nip(nip: str) -> Optional[dict]:
    clean_nip = re.sub(r"[^0-9]", "", nip or "")
    if len(clean_nip) != 10:
        raise RegonAPIError("Niepoprawny NIP – wymagane 10 cyfr.")

    api_key = getattr(settings, "REGON_API_KEY", "")
    if not api_key:
        raise RegonAPIError("Brak skonfigurowanego klucza API REGON.")

    client = RegonClient(api_key=api_key)
    try:
        return client.search_by_nip(clean_nip)
    finally:
        client.logout()
