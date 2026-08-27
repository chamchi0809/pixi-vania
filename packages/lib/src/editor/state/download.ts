import type { SvLevelProject } from '../../format/types';

function projectFileName(path: string): string {
	const [cleanPath = ''] = path.split(/[?#]/);
	return cleanPath.split('/').pop() || 'project.svlevel.json';
}

export function downloadProject(path: string, data: SvLevelProject): string {
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(data, null, '\t')], { type: 'application/json' })
	);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = projectFileName(path);
	anchor.click();
	URL.revokeObjectURL(url);
	return anchor.download;
}
