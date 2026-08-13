/**
 * The adjust drawer's categories.
 *
 * Kept out of the component file so the drawer exports only a component, and so
 * the category list has one definition rather than one per handler.
 */

import type { ComponentType } from 'react';
import {
  AdjustOption,
  FORMAT_OPTIONS,
  LENGTH_OPTIONS,
  TONE_OPTIONS,
} from '@/shared/constants';
import type { AdjustParams } from '@/shared/types';
import { FormatIcon, LengthIcon, ToneIcon } from './icons';

export type AdjustCategory = keyof AdjustParams;

export interface CategoryTab {
  readonly key: AdjustCategory;
  readonly label: string;
  readonly Icon: ComponentType<{ size?: number }>;
  readonly options: readonly AdjustOption<string>[];
}

export const CATEGORY_TABS: readonly CategoryTab[] = [
  { key: 'tone', label: 'Tone', Icon: ToneIcon, options: TONE_OPTIONS },
  { key: 'format', label: 'Format', Icon: FormatIcon, options: FORMAT_OPTIONS },
  { key: 'length', label: 'Length', Icon: LengthIcon, options: LENGTH_OPTIONS },
];

/** How many adjustments are currently set. */
export function countAdjustments(params: AdjustParams): number {
  return CATEGORY_TABS.filter((tab) => params[tab.key] != null).length;
}
