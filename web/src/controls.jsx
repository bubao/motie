import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ConfigSchema } from './core/index.js';
import { setField } from './store.js';

/**
 * Schema 驱动的控件工厂：min / max / step / zeroLabel 全部取自 ConfigSchema，
 * 避免 Panel 手写区间与 schema 漂移（D18 / T1.8）。
 */

/* 控件 id：首字母小写，与 Panel 的 htmlFor（traceCount / rowGap / gridSize / inkAlpha）一致 */
function fieldId(schemaKey) { return schemaKey.charAt(0).toLowerCase() + schemaKey.slice(1); }

/* 整数滑杆。max 可显式覆盖（如「每行格数」按纸宽动态上限）。
 * aria-valuetext 由 Panel 提供（读屏播报具体值，而非裸数字）。 */
export function SchemaRange({ schemaKey, display, max, disabled, ['aria-valuetext']: ariaValueText }) {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const spec = ConfigSchema[schemaKey];
	const upper = max != null ? max : spec.max;
	const value = Math.min(config[schemaKey], upper);
	return (
		<div className="rp-row">
			<input
				className="rp-range"
				id={fieldId(schemaKey)}
				type="range"
				min={spec.min}
				max={upper}
				step={spec.step || 1}
				value={value}
				disabled={disabled}
				aria-valuetext={ariaValueText != null ? ariaValueText : display}
				onChange={function (e) { dispatch(setField({ key: schemaKey, value: Number(e.target.value) })); }}
			/>
			<output>{display}</output>
		</div>
	);
}

/* 百分比滑杆：内部 0–1，UI 0–100。 */
export function SchemaPercentRange({ schemaKey, disabled, ['aria-valuetext']: ariaValueText }) {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const spec = ConfigSchema[schemaKey];
	const percent = Math.round(config[schemaKey] * 100);
	return (
		<div className="rp-row">
			<input
				className="rp-range"
				id={fieldId(schemaKey)}
				type="range"
				min={Math.round(spec.min * 100)}
				max={Math.round(spec.max * 100)}
				step={1}
				value={percent}
				disabled={disabled}
				aria-valuetext={ariaValueText != null ? ariaValueText : (percent + '%')}
				onChange={function (e) { dispatch(setField({ key: schemaKey, value: Number(e.target.value) / 100 })); }}
			/>
			<output>{percent}%</output>
		</div>
	);
}
