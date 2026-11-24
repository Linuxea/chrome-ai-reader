/**
 * Collapsible settings card — native <details> keeps no-JS semantics and
 * mirrors the legacy page's section folding.
 */
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function SectionCard({
  title,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="section-card" open={defaultOpen}>
      <summary className="section-card-summary">
        <span className="section-card-title">{title}</span>
        <ChevronDown size={16} className="section-card-chevron" aria-hidden />
      </summary>
      <div className="section-card-body">{children}</div>
    </details>
  );
}
