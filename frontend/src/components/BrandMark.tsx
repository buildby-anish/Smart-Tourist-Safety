import { Compass } from 'lucide-react';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

/** Compact square Suraksha Setu emblem (Ashoka-chakra compass on white). */
export default function BrandMark({ size = 32, className = '' }: BrandMarkProps) {
  const icon = Math.round(size * 0.56);
  return (
    <div
      className={`flex items-center justify-center rounded-md bg-white text-[#0C2340] shadow-sm border border-slate-200/80 flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Compass className="text-[#0C2340]" style={{ width: icon, height: icon }} strokeWidth={2.2} />
    </div>
  );
}
