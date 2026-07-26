import os
import time
from shutil import which
from typing import Optional
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from bs4 import BeautifulSoup
import logging

logger = logging.getLogger(__name__)

URL = "https://wyszukiwarkaregon.stat.gov.pl/appBIR/index.aspx"
CHROME_BINARY = os.getenv("CHROME_BINARY")
CHROMEDRIVER_PATH = os.getenv("CHROMEDRIVER_PATH")


def _resolve_chrome_binary() -> Optional[str]:
    candidates = [
        CHROME_BINARY,
        which("google-chrome"),
        which("google-chrome-stable"),
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        which("chromium"),
        which("chromium-browser"),
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/opt/render/project/src/.chrome/chrome/chrome",
        "/opt/render/project/.apt/usr/bin/chromium",
        "/opt/render/project/.apt/usr/bin/chromium-browser",
    ]
    # Snap-installed chromium binary
    snap_base = "/snap/chromium"
    if os.path.isdir(snap_base):
        try:
            versions = sorted(
                [d for d in os.listdir(snap_base) if d.isdigit()],
                key=int,
                reverse=True,
            )
            for ver in versions:
                snap_path = f"{snap_base}/{ver}/usr/lib/chromium-browser/chromium-browser"
                candidates.append(snap_path)
        except Exception:
            pass
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _resolve_chromedriver() -> Optional[str]:
    candidates = [
        CHROMEDRIVER_PATH,
        which("chromedriver"),
        "/usr/bin/chromedriver",
        "/usr/local/bin/chromedriver",
        "/usr/lib/chromium/chromedriver",
        "/usr/lib/chromium-browser/chromedriver",
        "/usr/lib/chrome/chromedriver",
        "/opt/render/project/src/.chrome/chromedriver/chromedriver",
        "/opt/render/project/.apt/usr/bin/chromedriver",
    ]
    # Snap-installed chromium chromedriver
    snap_base = "/snap/chromium"
    if os.path.isdir(snap_base):
        try:
            versions = sorted(
                [d for d in os.listdir(snap_base) if d.isdigit()],
                key=int,
                reverse=True,
            )
            for ver in versions:
                snap_path = f"{snap_base}/{ver}/usr/lib/chromium-browser/chromedriver"
                candidates.append(snap_path)
        except Exception:
            pass
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None

def _normalize_nip(nip: str) -> str:
    """Remove hyphens and spaces from NIP."""
    return nip.replace("-", "").replace(" ", "").strip()

def _scrape_by_nip(nip: str) -> dict:
    """Scrape REGON data for a given NIP using Selenium."""
    nip_clean = _normalize_nip(nip)
    if len(nip_clean) != 10 or not nip_clean.isdigit():
        return {"error": "Niepoprawny NIP – wymagane 10 cyfr.", "nip": nip_clean}

    # Configure Chrome (headless)
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,900")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-plugins")
    options.add_argument("--disable-setuid-sandbox")
    options.add_argument("--single-process")
    options.add_argument("--remote-debugging-port=0")
    options.add_argument("--disable-software-rasterizer")
    options.add_argument("--disable-background-networking")
    options.add_argument("--ignore-certificate-errors")
    chrome_binary = _resolve_chrome_binary()
    default_chrome_paths = {which("google-chrome"), "/usr/bin/google-chrome", which("google-chrome-stable"), "/usr/bin/google-chrome-stable"}
    if chrome_binary and chrome_binary not in default_chrome_paths:
        options.binary_location = chrome_binary

    driver_exec = _resolve_chromedriver()
    if driver_exec:
        service = Service(driver_exec)
        driver = webdriver.Chrome(service=service, options=options)
    else:
        # Let Selenium Manager auto-download matching chromedriver
        driver = webdriver.Chrome(options=options)

    try:
        # 1. Open the page
        driver.get(URL)
        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.ID, "txtNip"))
        )
        time.sleep(0.8)

        # 2. Enter NIP and click Search
        driver.find_element(By.ID, "txtNip").send_keys(nip_clean)
        driver.find_element(By.ID, "btnSzukaj").click()

        # 3. Wait for AJAX results
        end_time = time.time() + 20
        status = "timeout"
        while time.time() < end_time:
            try:
                div = driver.find_element(By.ID, "divListaJednostek")
                if div.text.strip():
                    status = "lista"
                    break
            except NoSuchElementException:
                pass
            try:
                komunikat = driver.find_element(By.ID, "divInfoKomunikat")
                if komunikat.is_displayed() and komunikat.text.strip():
                    return {"error": komunikat.text.strip(), "nip": nip_clean}
            except Exception:
                pass
            time.sleep(0.4)

        if status == "timeout":
            return {"error": "Timeout podczas oczekiwania na wyniki", "nip": nip_clean}

        # 4. Get basic data from results table
        soup = BeautifulSoup(driver.page_source, "html.parser")
        div_lista = soup.find(id="divListaJednostek")
        table = div_lista.find("table")
        rows = table.find_all("tr")
        headers = [th.get_text(strip=True) for th in rows[0].find_all(["th", "td"])]
        lista = []
        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if cells:
                row_data = {headers[i] if i < len(headers) else f"col_{i}": 
                           cell.get_text(strip=True) for i, cell in enumerate(cells)}
                lista.append(row_data)

        # 5. Click REGON link to open full report
        try:
            regon_link = driver.find_element(
                By.CSS_SELECTOR,
                "#divListaJednostek table tbody tr:first-child td:first-child a"
            )
            regon_link.click()
        except NoSuchElementException:
            return {"error": "Nie znaleziono linku do raportu", "nip": nip_clean}

        # 6. Wait for report to load
        end_time = time.time() + 20
        while time.time() < end_time:
            try:
                if driver.find_element(By.ID, "praw_regon9").text.strip():
                    break
                if driver.find_element(By.ID, "fiz_regon9").text.strip():
                    break
            except Exception:
                pass
            time.sleep(0.4)

        # 7. Parse full report
        soup2 = BeautifulSoup(driver.page_source, "html.parser")

        # Entity type (visible h2)
        typ = ""
        for h2 in driver.find_elements(By.TAG_NAME, "h2"):
            if h2.is_displayed() and h2.text.strip():
                typ = h2.text.strip()
                break

        # Legal person data
        praw_ids = {
            "regon": "praw_regon9", "nip": "praw_nip", "nazwa": "praw_nazwa",
            "forma_prawna": "praw_nazwaPodstawowejFormyPrawnej",
            "szczegolna_forma_prawna": "praw_nazwaSzczegolnejFormyPrawnej",
            "forma_wlasnosci": "praw_nazwaFormyWlasnosci",
            "organ_rejestrowy": "praw_nazwaOrganuRejestrowego",
            "rodzaj_rejestru": "praw_nazwaRodzajuRejestru",
            "kraj": "praw_adSiedzNazwaKraju",
            "wojewodztwo": "praw_adSiedzNazwaWojewodztwa",
            "powiat": "praw_adSiedzNazwaPowiatu",
            "gmina": "praw_adSiedzNazwaGminy",
            "miejscowosc": "praw_adSiedzNazwaMiejscowosci",
            "ulica": "praw_adSiedzNazwaUlicy",
            "nr_nieruchomosci": "praw_adSiedzNumerNieruchomosci",
            "kod_pocztowy": "praw_adSiedzKodPocztowy",
            "data_powstania": "praw_dataPowstania",
            "data_wpisu_regon": "praw_dataWpisuDoRegon",
            "telefon": "praw_numerTelefonu",
            "email": "praw_adresEmail",
            "www": "praw_adresStronyInternetowej",
        }

        dane = {}
        for key, elem_id in praw_ids.items():
            elem = soup2.find(id=elem_id)
            if elem:
                val = elem.get_text(strip=True)
                if val:
                    dane[key] = val

        # If no legal person data, try natural person
        if not dane:
            fiz_ids = {
                "regon": "fiz_regon9", "nip": "fiz_nip",
                "imie": "fiz_imie", "nazwisko": "fiz_nazwisko",
                "nazwa": "fiz_nazwa",
                "miejscowosc": "fiz_adSiedzNazwaMiejscowosci",
                "ulica": "fiz_adSiedzNazwaUlicy",
                "kod_pocztowy": "fiz_adSiedzKodPocztowy",
            }
            for key, elem_id in fiz_ids.items():
                elem = soup2.find(id=elem_id)
                if elem:
                    val = elem.get_text(strip=True)
                    if val:
                        dane[key] = val

        return {
            "nip_zapytanie": nip_clean,
            "lista_podmiotow": lista,
            "raport": {
                "typ_podmiotu": typ,
                "dane": dane,
            }
        }

    except TimeoutException as e:
        logger.error(f"Timeout during REGON scraping for NIP {nip_clean}: {e}")
        return {"error": "Timeout podczas ładowania strony", "nip": nip_clean}
    except Exception as e:
        logger.error(f"Unexpected error during REGON scraping for NIP {nip_clean}: {e}")
        return {"error": f"Błąd podczas scrapowania: {str(e)}", "nip": nip_clean}
    finally:
        driver.quit()

def lookup_client_by_nip_scraper(nip: str) -> Optional[dict]:
    """Public API compatible with the original lookup_client_by_nip."""
    result = _scrape_by_nip(nip)
    if "error" in result:
        from .regon import RegonAPIError
        raise RegonAPIError(result["error"])

    # Map scraped data to the expected format
    raport = result.get("raport", {})
    dane = raport.get("dane", {})

    # Build street address
    street_parts = [dane.get("ulica", ""), dane.get("nr_nieruchomosci", "")]
    street = " ".join(part for part in street_parts if part).strip()

    return {
        "name": dane.get("nazwa", ""),
        "nip": dane.get("nip", ""),
        "regon": dane.get("regon", ""),
        "city": dane.get("miejscowosc", ""),
        "postal_code": dane.get("kod_pocztowy", ""),
        "street": street,
        "voivodeship": dane.get("wojewodztwo", ""),
    }
