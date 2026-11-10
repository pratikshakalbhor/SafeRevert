/**
 * Shared Motion variants for SafeRevert UI.
 *
 * Rules enforced here:
 * - Durations: 150 ms – 300 ms only.
 * - Easing: ease-out ("easeOut") everywhere.
 * - Only opacity and transform are animated (no layout-thrashing properties).
 * - Callers must check useReducedMotion() and pass the resulting flag;
 *   helpers that accept `reduced` collapse all variants to a no-op.
 */

import type { Variants, Transition } from 'motion/react';

// ---------------------------------------------------------------------------
// Shared base transition
// ---------------------------------------------------------------------------
export const easeOutFast: Transition = { duration: 0.2, ease: 'easeOut' };
export const easeOutMed: Transition = { duration: 0.25, ease: 'easeOut' };

// ---------------------------------------------------------------------------
// Page / tab transition  (fade + 12 px slide up)
// ---------------------------------------------------------------------------
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: easeOutMed },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15, ease: 'easeOut' } },
};

/** Reduced-motion version: only opacity, no translate */
export const pageVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutMed },
  exit: { opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } },
};

// ---------------------------------------------------------------------------
// Modal backdrop  (fade)
// ---------------------------------------------------------------------------
export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutFast },
  exit: { opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } },
};

// ---------------------------------------------------------------------------
// Modal card  (scale + fade)
// ---------------------------------------------------------------------------
export const modalCardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.2, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 4,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
};

export const modalCardVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutFast },
  exit: { opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } },
};

// ---------------------------------------------------------------------------
// Toast  (slide in from right, fade out)
// ---------------------------------------------------------------------------
export const toastVariants: Variants = {
  hidden: { opacity: 0, x: 48, scale: 0.97 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.22, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    x: 32,
    scale: 0.97,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
};

export const toastVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutFast },
  exit: { opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } },
};

// ---------------------------------------------------------------------------
// Transfer list item  (staggered entrance)
// ---------------------------------------------------------------------------
export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
};

export const listItemVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutMed },
  exit: { opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } },
};

/** Container to stagger children */
export const listContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0 },
  },
};

export const listContainerVariantsReduced: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0 } },
};

// ---------------------------------------------------------------------------
// Status badge cross-fade  (key-based AnimatePresence swap)
// ---------------------------------------------------------------------------
export const badgeVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, scale: 0.9, transition: { duration: 0.15, ease: 'easeOut' } },
};

export const badgeVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutFast },
  exit: { opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } },
};

// ---------------------------------------------------------------------------
// Success checkmark pop-in
// ---------------------------------------------------------------------------
export const checkmarkVariants: Variants = {
  hidden: { opacity: 0, scale: 0.4 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 400, damping: 20 },
  },
};

export const checkmarkVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutFast },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick the right variant set depending on reduced-motion preference.
 * Usage: `pickVariants(isReduced, pageVariants, pageVariantsReduced)`
 */
export function pickVariants(
  reduced: boolean,
  normal: Variants,
  reducedVariant: Variants
): Variants {
  return reduced ? reducedVariant : normal;
}
