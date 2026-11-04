import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

const QUIET_ZONE = 4;

/**
 * QR code drawn as SVG paths in the page itself: the otpauth URI contains the seed, so it goes to no
 * external service, and the CSP (img-src 'self') would block a data: image anyway.
 */
@Component({
  selector: 'app-qr-code',
  template: `
    @let drawing = shape();
    <svg
      class="qr"
      [attr.viewBox]="'0 0 ' + drawing.size + ' ' + drawing.size"
      role="img"
      i18n-aria-label="@@qr.label"
      aria-label="QR code to scan in the Authenticator app"
      focusable="false"
      shape-rendering="crispEdges"
    >
      <rect [attr.width]="drawing.size" [attr.height]="drawing.size" fill="#ffffff" />
      <path [attr.d]="drawing.path" fill="#000000" />
    </svg>
  `,
  styles: `
    .qr {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--pm-radius);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QrCode {
  readonly value = input.required<string>();

  protected readonly shape = computed(() => {
    const code = qrcode(0, 'M');
    code.addData(this.value());
    code.make();
    const count = code.getModuleCount();
    let path = '';
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) {
          path += `M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
        }
      }
    }
    return { size: count + 2 * QUIET_ZONE, path };
  });
}
