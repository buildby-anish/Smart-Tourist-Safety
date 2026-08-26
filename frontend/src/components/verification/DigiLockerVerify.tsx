/**
 * Suraksha Setu - DigiLocker KYC verification component.
 *
 * Additional, swappable verification path alongside IdentityVerification's
 * OCR upload flow — same onVerificationComplete contract, so LoginModal can
 * plug either component into the same 'kyc' step without extra branching.
 */

import { useState } from "react";
import { ShieldCheck, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import {
  initiateDigiLocker,
  fetchDigiLockerDocument,
  confirmDigiLocker,
  DigiLockerConfirmResult,
} from "../../lib/api";

export interface DigiLockerVerifyProps {
  touristId: string;
  onVerificationComplete?: (result: DigiLockerConfirmResult) => void;
  className?: string;
}

type Phase = "select" | "fetching" | "review" | "confirming" | "done" | "error";

const DOC_TYPES: { value: "AADHAAR" | "PAN" | "DRIVING_LICENCE" | "VOTER_ID"; label: string }[] = [
  { value: "AADHAAR", label: "Aadhaar" },
  { value: "PAN", label: "PAN Card" },
  { value: "DRIVING_LICENCE", label: "Driving Licence" },
  { value: "VOTER_ID", label: "Voter ID" },
];

export function DigiLockerVerify({ touristId, onVerificationComplete, className }: DigiLockerVerifyProps) {
  const [phase, setPhase] = useState<Phase>("select");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fetched, setFetched] = useState<{ full_name: string; masked_document_number: string; document_type: string } | null>(null);
  const [result, setResult] = useState<DigiLockerConfirmResult | null>(null);
  const [mockMode, setMockMode] = useState(true);

  const handleSelectDoc = async (docType: (typeof DOC_TYPES)[number]["value"]) => {
    setError(null);
    setPhase("fetching");
    try {
      const initiated = await initiateDigiLocker(touristId, docType);
      setMockMode(initiated.mock_mode);
      if (initiated.auth_url) {
        // Real OAuth mode: hand off to DigiLocker's own login page.
        window.location.href = initiated.auth_url;
        return;
      }
      setSessionId(initiated.session_id);
      const doc = await fetchDigiLockerDocument(initiated.session_id);
      setFetched({ full_name: doc.full_name, masked_document_number: doc.masked_document_number, document_type: doc.document_type });
      setPhase("review");
    } catch (e: any) {
      setError(e?.message || "Could not reach DigiLocker. Please try again.");
      setPhase("error");
    }
  };

  const handleConfirm = async () => {
    if (!sessionId) return;
    setPhase("confirming");
    setError(null);
    try {
      const confirmed = await confirmDigiLocker(sessionId);
      setResult(confirmed);
      setPhase("done");
      onVerificationComplete?.(confirmed);
    } catch (e: any) {
      setError(e?.message || "Verification failed. Please try again.");
      setPhase("error");
    }
  };

  return (
    <div className={className}>
      {phase === "select" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Verify instantly using a document already linked to your DigiLocker.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DOC_TYPES.map((d) => (
              <button
                key={d.value}
                onClick={() => handleSelectDoc(d.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "fetching" && (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-4">
          <Loader2 size={16} className="animate-spin" /> Fetching document from DigiLocker…
        </div>
      )}

      {phase === "review" && fetched && (
        <div className="space-y-3">
          {mockMode && (
            <div className="text-[11px] rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 px-2 py-1">
              Demo mode — this uses a sandbox document, not your real DigiLocker.
            </div>
          )}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">Name</span><span className="font-medium">{fetched.full_name}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Document</span><span className="font-medium">{fetched.masked_document_number}</span></div>
          </div>
          <button
            onClick={handleConfirm}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 transition-colors"
          >
            Confirm & Verify
          </button>
        </div>
      )}

      {phase === "confirming" && (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-4">
          <Loader2 size={16} className="animate-spin" /> Anchoring verification…
        </div>
      )}

      {phase === "done" && result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
            <ShieldCheck size={18} /> KYC Verified
          </div>
          {result.blockchain_tx_hash && (
            <a
              href={result.blockchain_adapter === "sepolia"
                ? `https://sepolia.etherscan.io/tx/${result.blockchain_tx_hash}`
                : undefined}
              target={result.blockchain_adapter === "sepolia" ? "_blank" : undefined}
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:opacity-70"
            >
              {result.blockchain_adapter === "sepolia" ? (
                <>View on Sepolia Etherscan <ExternalLink size={12} /></>
              ) : (
                <>Anchored on offline demo ledger — block #{result.blockchain_block_number}</>
              )}
            </a>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle size={16} /> {error}
          </div>
          <button onClick={() => setPhase("select")} className="text-xs underline text-slate-500">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
