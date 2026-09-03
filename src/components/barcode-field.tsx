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
export function BarcodeField({
  name = 'gtin',
  defaultValue = '',
  autoFocus = false,
}: {
  name?: string;
  defaultValue?: string;
  /** Counting scans back to back; the field should be live without a tap. */
  autoFocus?: boolean;
}) {
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
        /*
         * EAN-13/8 are the retail unit. ITF is the shipping case: a case
         * barcode is normally GTIN-14 printed as ITF-14, a different symbology
         * entirely, so without ITF here the camera silently fails on every
         * delivery even though ean.ts validates GTIN-14 happily.
         *
         * UPC-A/E are included because own-brand and imported stock from US
         * suppliers still carries them.
         *
         * QR and DataMatrix are here for a supplier's GS1-encoded box label —
         * quantity, lot, expiry, not just an identifier — decoded by
         * `parseGs1` on the Receive screen. This field itself stays dumb:
         * whatever the camera decodes goes straight into the input, same as
         * any other format.
         *
         * The list stays deliberately short beyond that. Every extra format is
         * another chance to mis-decode a blurry code in bad light, and a wrong
         * barcode that happens to match another product is worse than no scan.
         */
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
        ],
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
    // Same desktop cap as Field, which this deliberately does not use: it owns
    // its own label and scan button. A barcode is 8-14 characters; the input
    // has no business being 896px wide on a till screen.
    <div className="flex flex-col gap-2 md:max-w-lg">
      <Label htmlFor={name}>{t('barcodeLabel')}</Label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={name}
          name={name}
          inputMode="numeric"
          autoComplete="off"
          defaultValue={defaultValue}
          autoFocus={autoFocus}
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
