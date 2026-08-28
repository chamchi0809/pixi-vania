export interface FixedStepResult {
	accumulator: number;
	steps: number;
}

/** Pure fixed-step scheduler used by the demo and its 60/120/165Hz regression check. */
export function fixedStepSchedule(
	accumulator: number,
	deltaMs: number,
	fixedDt = 1 / 60,
	maxSteps = 5
): FixedStepResult {
	let next = Math.min(fixedDt * maxSteps, accumulator + Math.min(Math.max(0, deltaMs), 250) / 1000);
	let steps = 0;
	while (next + Number.EPSILON >= fixedDt && steps < maxSteps) {
		next -= fixedDt;
		steps++;
	}
	return { accumulator: Math.max(0, next), steps };
}
