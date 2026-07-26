from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from .working_days import shift_to_business_day


@dataclass(frozen=True)
class PlanComputationContext:
    created_date: date
    cycle_days: int
    last_contact_date: Optional[date] = None
    recorded_next_date: Optional[date] = None
    cycle_start_date: Optional[date] = None


@dataclass(frozen=True)
class PlanComputationResult:
    due_date: date
    raw_due_date: date
    previous_due_date: Optional[date]


def compute_due_date(
    ctx: PlanComputationContext,
    target_date: date,
    max_cycles: int = 512,
) -> Optional[PlanComputationResult]:
    """Return the first due date >= target_date while remembering the previous cycle."""

    if ctx.cycle_days <= 0:
        return None

    base = ctx.cycle_start_date or ctx.last_contact_date or ctx.created_date
    if base is None:
        return None

    delta = timedelta(days=ctx.cycle_days)
    candidate_raw = ctx.recorded_next_date or (base + delta)
    candidate_shifted = shift_to_business_day(candidate_raw)
    previous_shifted: Optional[date] = None

    steps = 0
    while candidate_shifted < target_date and steps < max_cycles:
        if steps == 0:
            # First candidate is already in the past – treat as overdue regardless of source
            return PlanComputationResult(
                due_date=target_date,
                raw_due_date=candidate_raw,
                previous_due_date=candidate_shifted,
            )
        previous_shifted = candidate_shifted
        candidate_raw = candidate_shifted + delta
        candidate_shifted = shift_to_business_day(candidate_raw)
        steps += 1

    if steps >= max_cycles:
        return None

    return PlanComputationResult(
        due_date=candidate_shifted,
        raw_due_date=candidate_raw,
        previous_due_date=previous_shifted,
    )
