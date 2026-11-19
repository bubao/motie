/**
 * toast slice 回归测试（node test/toast.test.mjs）。
 * toastSlice 为纯 Redux slice（无 React / DOM 依赖），直接驱动 reducer。
 */
import assert from 'node:assert/strict';
import reducer, { pushToast, dismissToast } from '../web/src/toastSlice.mjs';

let state = reducer(undefined, { type: '@@INIT' });
assert.deepStrictEqual(state, { toasts: [] });

state = reducer(state, pushToast({ type: 'success', text: '已导出 PDF。' }));
assert.strictEqual(state.toasts.length, 1);
assert.strictEqual(state.toasts[0].type, 'success');
assert.strictEqual(state.toasts[0].text, '已导出 PDF。');
assert.ok(state.toasts[0].id > 0);
assert.strictEqual(state.toasts[0].action, null);

const firstId = state.toasts[0].id;

/* 默认类型 info；多条并存 */
state = reducer(state, pushToast({ text: '无类型提示' }));
assert.strictEqual(state.toasts.length, 2);
assert.strictEqual(state.toasts[1].type, 'info');

/* 关闭指定条目，不影响其他 */
state = reducer(state, dismissToast(firstId));
assert.strictEqual(state.toasts.length, 1);
assert.strictEqual(state.toasts[0].text, '无类型提示');

/* 失败提示携带重试动作 */
state = reducer(state, pushToast({ type: 'error', text: '导出失败', action: { label: '重试', onClick: () => {} } }));
assert.strictEqual(state.toasts[1].type, 'error');
assert.strictEqual(state.toasts[1].action.label, '重试');
assert.strictEqual(typeof state.toasts[1].action.onClick, 'function');

/* 关闭不存在的 id 不炸 */
state = reducer(state, dismissToast(99999));
assert.strictEqual(state.toasts.length, 2);

console.log('toast slice 测试通过（7 断言）');
