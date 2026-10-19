'use client';

import { useState } from 'react';
import { decisionRecordJson, decisionRecordMarkdown } from '@/lib/exportRecord';
import type { Assumptions, Decision, Workload } from '@/lib/types';

interface Props {
  workload: Workload;
  assumptions: Assumptions;
  decision: Decision;
  shareUrl: string;
}

async function copy(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the textarea path
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(el);
  }
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * A result is only useful if it can leave the page. These produce something
 * you can paste into an ADR, a ticket or an RFC, carrying the assumptions
 * actually used so a reviewer can see whether the model was calibrated.
 */
export function ExportPanel({ workload, assumptions, decision, shareUrl }: Props) {
  const [flash, setFlash] = useState<string | null>(null);

  const announce = (message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(null), 1800);
  };

  return (
    <div className="card">
      <div className="card-h">TAKE IT WITH YOU</div>
      <div className="ex-row">
        <button
          type="button"
          onClick={async () => {
            await copy(shareUrl);
            announce('link copied');
          }}
        >
          copy link
        </button>
        <button
          type="button"
          data-testid="copy-markdown"
          onClick={async () => {
            await copy(decisionRecordMarkdown(workload, assumptions, decision, shareUrl));
            announce('markdown copied');
          }}
        >
          copy as markdown
        </button>
        <button
          type="button"
          onClick={() => {
            download(
              'vector-store-decision.json',
              JSON.stringify(
                decisionRecordJson(workload, assumptions, decision, shareUrl),
                null,
                2,
              ),
              'application/json',
            );
            announce('json downloaded');
          }}
        >
          download json
        </button>
        {flash ? (
          <span className="ok" role="status">
            {flash}
          </span>
        ) : null}
      </div>
      <p className="ex-note">
        The record carries the assumptions you used, not the shipped defaults, so a reviewer
        can tell whether the model was calibrated.
      </p>
    </div>
  );
}
