'use client';

/**
 * Field controls that need their own state or browser APIs.
 *
 * Split out of `form-renderer.tsx` because each carries meaningful behaviour —
 * canvas drawing, camera access, file validation — rather than being a styled
 * input. Keeping them here stops the renderer becoming unreadable.
 */

import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────
// Signature
// ─────────────────────────────────────────────────────────────

/**
 * Draw-to-sign pad.
 *
 * Captures at device pixel ratio so a signature taken on a phone is not a blurry
 * mess when it lands on a PDF. The stored value is a data URL; the consultation
 * record also keeps a hash of it alongside the consent text version, so we can
 * always prove what was signed and when.
 */
export function SignatureField({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value?: string;
  onChange: (dataUrl: string | undefined) => void;
  invalid?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(Boolean(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.scale(ratio, ratio);
    context.strokeStyle = '#241536';
    context.lineWidth = 2.2;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    // Restore an existing signature when navigating back to this step.
    if (value) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = value;
    }
  }, [value]);

  function pointFrom(event: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const source = 'touches' in event ? event.touches[0]! : event;
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  }

  function start(event: React.MouseEvent | React.TouchEvent) {
    event.preventDefault();
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    drawing.current = true;
    setHasInk(true);
    const point = pointFrom(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function move(event: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    event.preventDefault();

    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    const point = pointFrom(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current?.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(undefined);
  }

  return (
    <div>
      <div className={`overflow-hidden rounded-lg border bg-surface ${invalid ? 'border-triage-red-700' : 'border-line'}`}>
        <canvas
          ref={canvasRef}
          id={id}
          aria-label="Signature area"
          className="block h-40 w-full cursor-crosshair touch-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(transparent, transparent 39px, var(--color-line) 40px)',
          }}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
        <div className="flex items-center justify-between border-t border-line bg-canvas px-3 py-2 text-xs text-ink-soft">
          <span>Sign with your finger or mouse</span>
          <button type="button" onClick={clear} className="font-semibold text-brand-600">
            Clear
          </button>
        </div>
      </div>
      {/*
        Keyboard-only users cannot draw. Offering a typed alternative is an
        accessibility requirement, not a convenience.
      */}
      {!hasInk && (
        <p className="mt-1.5 text-xs text-ink-soft">
          Unable to sign on screen? A member of staff can record your consent on your behalf.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// File upload
// ─────────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

/**
 * File upload for ID documents and letters.
 *
 * Validates type and size client-side for immediate feedback. The server must
 * validate again and virus-scan — a client-side check is a courtesy to the user,
 * never a security control.
 */
export function FileUploadField({
  id,
  value,
  onChange,
  invalid,
  helpText,
}: {
  id: string;
  value?: UploadedFile;
  onChange: (file: UploadedFile | undefined) => void;
  invalid?: boolean;
  helpText?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    setError(null);
    if (!file) return;

    if (!ACCEPTED.includes(file.type)) {
      setError('Please upload a photo (JPG, PNG or WEBP) or a PDF.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That file is larger than 10MB. Please use a smaller one.');
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    }).catch(() => null);

    if (!dataUrl) {
      setError('Could not read that file. Please try again.');
      return;
    }

    onChange({ name: file.name, type: file.type, size: file.size, dataUrl });
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-clinical-green-600 bg-clinical-green-100 p-3">
        {value.type.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.dataUrl} alt="" className="h-14 w-14 flex-none rounded object-cover" />
        ) : (
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded bg-surface font-mono text-xs">
            PDF
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{value.name}</p>
          <p className="text-xs text-ink-soft">{Math.round(value.size / 1024)} KB · uploaded</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="flex-none rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold"
        >
          Replace
        </button>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={id}
        className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed p-6 text-center ${
          invalid || error ? 'border-triage-red-700 bg-triage-red-100' : 'border-line bg-surface'
        }`}
      >
        <span className="text-sm font-semibold text-brand-600">Choose a file</span>
        <span className="text-xs text-ink-soft">{helpText ?? 'JPG, PNG or PDF, up to 10MB'}</span>
        <input
          id={id}
          type="file"
          accept={ACCEPTED.join(',')}
          className="sr-only"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </label>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-triage-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Photo capture
// ─────────────────────────────────────────────────────────────

/**
 * Live camera capture.
 *
 * Used where the client's reference site requires a live photo rather than an
 * upload — proving the person is present, not submitting an old picture.
 *
 * Falls back to file upload when there is no camera or permission is refused.
 * A patient on a desktop without a webcam must still be able to complete the
 * form.
 */
export function PhotoCaptureField({
  id,
  value,
  onChange,
  invalid,
  helpText,
}: {
  id: string;
  value?: UploadedFile;
  onChange: (file: UploadedFile | undefined) => void;
  invalid?: boolean;
  helpText?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always release the camera. A live indicator left on after the form is
  // submitted is alarming and looks like a bug.
  useEffect(() => () => stopCamera(), []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  }

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 } },
      });
      streamRef.current = stream;
      setActive(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setError('We could not access your camera. You can upload a photo instead.');
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    stopCamera();
    onChange({ name: 'photo.jpg', type: 'image/jpeg', size: dataUrl.length, dataUrl });
  }

  if (value) {
    return (
      <div className="rounded-lg border border-clinical-green-600 bg-clinical-green-100 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value.dataUrl} alt="Captured photo" className="mb-2 w-full rounded" />
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="rounded-full border border-line bg-surface px-4 py-1.5 text-xs font-semibold"
        >
          Retake
        </button>
      </div>
    );
  }

  return (
    <div>
      {active ? (
        <div className="overflow-hidden rounded-lg border border-line bg-brand-900">
          <video ref={videoRef} autoPlay playsInline muted className="w-full" />
          <div className="flex justify-between gap-2 p-3">
            <button
              type="button"
              onClick={stopCamera}
              className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={capture}
              className="rounded-full bg-white px-5 py-2 text-sm font-bold text-brand-900"
            >
              Take photo
            </button>
          </div>
        </div>
      ) : (
        <div className={`rounded-lg border-2 border-dashed p-6 text-center ${invalid ? 'border-triage-red-700' : 'border-line'}`}>
          <p className="mb-3 text-xs text-ink-soft">
            {helpText ?? 'Stand where your face is clearly visible and well lit.'}
          </p>
          <button
            type="button"
            onClick={() => void startCamera()}
            className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white"
          >
            Open camera
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2">
          <p role="alert" className="mb-2 text-xs font-semibold text-triage-red-700">
            {error}
          </p>
          <FileUploadField id={`${id}-fallback`} onChange={onChange} helpText="Upload a photo instead" />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Address
// ─────────────────────────────────────────────────────────────

export interface AddressValue {
  line1: string;
  line2?: string;
  town: string;
  postcode: string;
}

/**
 * Structured address.
 *
 * Separate fields rather than a textarea, because the town and postcode are
 * needed individually — for patient search, for GP catchment, and for the
 * address block on a prescription.
 */
export function AddressField({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value?: AddressValue;
  onChange: (value: AddressValue) => void;
  invalid?: boolean;
}) {
  const current: AddressValue = value ?? { line1: '', town: '', postcode: '' };

  function update(patch: Partial<AddressValue>) {
    onChange({ ...current, ...patch });
  }

  const inputClass = `w-full rounded-lg border px-3 py-2.5 ${
    invalid ? 'border-triage-red-700 bg-triage-red-100' : 'border-line'
  }`;

  return (
    <div className="space-y-2">
      <input
        id={id}
        aria-label="Address line 1"
        placeholder="House number and street"
        value={current.line1}
        onChange={(e) => update({ line1: e.target.value })}
        className={inputClass}
      />
      <input
        aria-label="Address line 2"
        placeholder="Address line 2 (optional)"
        value={current.line2 ?? ''}
        onChange={(e) => update({ line2: e.target.value })}
        className={inputClass}
      />
      <div className="flex gap-2">
        <input
          aria-label="Town"
          placeholder="Town"
          value={current.town}
          onChange={(e) => update({ town: e.target.value })}
          className={`${inputClass} flex-1`}
        />
        <input
          aria-label="Postcode"
          placeholder="IM1 1AA"
          value={current.postcode}
          onChange={(e) => update({ postcode: e.target.value.toUpperCase() })}
          className={`${inputClass} w-32 font-mono uppercase`}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Scale
// ─────────────────────────────────────────────────────────────

/**
 * 0–5 rating.
 *
 * The client raised the possibility of a scored model as an alternative to
 * branching rules in the GLP-1 engine. This is the input that would feed it.
 */
export function ScaleField({
  id,
  value,
  onChange,
  min = 0,
  max = 5,
  invalid,
}: {
  id: string;
  value?: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  invalid?: boolean;
}) {
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div className="flex gap-1.5" role="group" id={id}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`h-11 flex-1 rounded-lg border font-semibold ${
            value === option
              ? 'border-brand-600 bg-brand-600 text-white'
              : invalid
                ? 'border-triage-red-700'
                : 'border-line bg-surface'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
