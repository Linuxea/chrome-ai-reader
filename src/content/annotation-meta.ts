import type { AnnotationPerspective } from '../shared/types';

export const ICON_BY_PERSPECTIVE: Record<AnnotationPerspective, string> = {
  critique: '🤨',
  counterpoint: '⚖️',
  flaw: '🔍',
};

export const LABEL_BY_PERSPECTIVE: Record<AnnotationPerspective, string> = {
  critique: '批判',
  counterpoint: '反方',
  flaw: '漏洞',
};
