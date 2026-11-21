import { useSelector, useDispatch } from 'react-redux';
import { pushToast } from './store.js';

/* 打印：与「导出 PDF」保持同一前置校验（P3-15）。
 * 空内容时两者都应「不输出 + 提示」，否则打印会输出空白页。 */
export function usePrint() {
	const content = useSelector(function (s) { return s.config.Content; });
	const dispatch = useDispatch();

	return function print() {
		if (!String(content || '').trim()) {
			dispatch(pushToast({ type: 'error', text: '请先输入字帖内容' }));
			return;
		}
		window.print();
	};
}
