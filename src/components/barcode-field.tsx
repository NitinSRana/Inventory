'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Barcode entry: type it, or scan it with the camera.
 *
 * Typing is the primary path, not the fallback. Cameras fail, permission gets
 * refused, and gloved hands in a chilled aisle miss small targets — a scan flow
 * that cannot be completed by hand is a flow that strands people.
 *
 * The camera opens inline rather than in a modal: modals need two hands.
 */
export function BarcodeField({ name = 'gtin', defaultValue = '' }: { name?: string; defaultValue?: string }) {
  const t = useTranslations('scan');
  const inputRef = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    try {
      await scannerRef.current?.stop();
      scannerRef.current?.clear();
    } catch {
      // Already stopped; nothing to unwind.
    }
    scannerRef.current = null;
    setScanning(false);
  }

  async function start() {
    setError(null);
    setScanning(true);
    try {
      // Imported on demand: it touches navigator.mediaDevices and must not run
      // during server rendering or on a page that never scans.
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(regionRef.current!.id, {
        formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8],
        verbose: false,
      });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 140 } },
        (decoded) => {
          if (inputRef.current) inputRef.current.value = decoded;
          void stop();
          inputRef.current?.form?.requestSubmit();
        },
        () => {
          // Per-frame decode misses are normal; only fatal errors matter.
        },
      );
    } catch {
      setError(t('cameraUnavailable'));
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{t('barcodeLabel')}</Label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={name}
          name={name}
          inputMode="numeric"
          autoComplete="off"
          defaultValue={defaultValue}
          className="h-12 flex-1 font-mono"
        />
        <Button
          type="button"
          variant="outline"
          className="h-12 px-4"
          onClick={scanning ? stop : start}
          aria-pressed={scanning}
        >
          {scanning ? t('stop') : t('scan')}
        </Button>
      </div>

      {/* Reserved id: html5-qrcode mounts the video stream into this node. */}
      <div id={`${name}-scan-region`} ref={regionRef} className={scanning ? 'rounded-lg border' : 'hidden'} />

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
