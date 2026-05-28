'use client';

export function ImagePreview({ src, loading }: { src: string | null; loading?: boolean }) {
  if (!src) {
    return (
      <div className="result empty">
        {loading ? '' : 'no result yet — click generate'}
      </div>
    );
  }
  return (
    <div className="result">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Generated M typography" />
    </div>
  );
}
