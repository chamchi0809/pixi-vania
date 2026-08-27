/**
 * Publishes a range input's progress as `--range-p` (0%..100%) so CSS can paint
 * the filled part of the track. There is no cross-browser `::slider-fill` yet.
 */
export function rangeFill(el: HTMLInputElement, _value?: unknown) {
	const update = () => {
		const min = Number(el.min || 0);
		const max = Number(el.max === '' ? 100 : el.max);
		const p = max === min ? 0 : ((Number(el.value) - min) / (max - min)) * 100;
		el.style.setProperty('--range-p', `${Math.max(0, Math.min(100, p))}%`);
	};
	update();
	el.addEventListener('input', update);
	return {
		// `use:rangeFill={value}` re-runs this when the bound value changes externally.
		update,
		destroy: () => el.removeEventListener('input', update)
	};
}
