import assert from 'node:assert';
import { fixedStepSchedule } from './src/fixedStep.ts';

for (const hz of [60, 120, 165]) {
	let accumulator = 0;
	let steps = 0;
	for (let frame = 0; frame < hz * 10; frame++) {
		const result = fixedStepSchedule(accumulator, 1000 / hz);
		accumulator = result.accumulator;
		steps += result.steps;
	}
	assert.ok(Math.abs(steps - 600) <= 1, `${hz}Hz produced ${steps} physics steps over 10s`);
}

const stalled = fixedStepSchedule(0, 500);
assert.equal(stalled.steps, 5);
assert.ok(stalled.accumulator < 1 / 60);
console.log('fixed-step timing: OK');
