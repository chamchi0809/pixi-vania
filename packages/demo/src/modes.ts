/** The mode registry. Adding a game shape means adding a file and one entry here. */
import type { GameMode, Mode } from './game';
import { platformer } from './platformer';
import { topdown } from './topdown';

export const MODES: Record<Mode, GameMode> = { platformer, topdown };
export const MODE_LIST: GameMode[] = [platformer, topdown];
