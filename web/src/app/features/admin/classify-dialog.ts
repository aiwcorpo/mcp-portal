import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { Risk, ToolAction } from '../../api/generated';
import { Notice } from '../../shared/notice';
import { riskLabel } from '../../shared/labels';
import { ALLOWED_ACTIONS, Classification, RISKS, allowedPair } from './classification';

export interface ClassifyDialogData {
  /** Gateway-prefixed name of the tool. */
  toolName: string;
  /** What the foreign server says about the tool (annotations), already neutralised: untrusted hints, never defaults. */
  hints: readonly string[];
  /** The classification an administrator gave this tool earlier; shown as a suggestion, never applied by itself. */
  previous: Classification | null;
  /** The choice that was just refused, so that the dialog opens with it again, and why. */
  retry: { choice: Classification; message: string } | null;
}

const ACTION_LABELS: Record<ToolAction, () => string> = {
  read: () => $localize`:@@classify.action.read:read: reads data`,
  update: () => $localize`:@@classify.action.update:update: changes data`,
  delete: () => $localize`:@@classify.action.delete:delete: deletes data`,
  admin: () => $localize`:@@classify.action.admin:admin: administrative operation`,
};

/**
 * Classification of a tool of a foreign server (CC-193). The adapter does not say how dangerous a tool is, so the
 * administrator does, once, when approving it. Nothing is preselected: the hints of the server are text to read, and a
 * wrong READ_ONLY would let the tool change data without a code from the Authenticator.
 */
@Component({
  selector: 'app-classify-dialog',
  imports: [MatDialogModule, MatButtonModule, Notice],
  templateUrl: './classify-dialog.html',
  styleUrl: './classify-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassifyDialog {
  protected readonly data = inject<ClassifyDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ClassifyDialog, Classification>>(MatDialogRef);

  protected readonly risks = RISKS;
  protected readonly riskLabel = riskLabel;
  protected readonly actionLabel = (action: ToolAction): string => ACTION_LABELS[action]();
  protected readonly previousText = this.data.previous
    ? `${riskLabel(this.data.previous.risk)} (${this.data.previous.risk}, ${this.data.previous.action})`
    : null;

  protected readonly risk = signal<Risk | null>(this.data.retry?.choice.risk ?? null);
  protected readonly action = signal<ToolAction | null>(this.data.retry?.choice.action ?? null);
  protected readonly actions = computed(() => {
    const risk = this.risk();
    return risk ? ALLOWED_ACTIONS[risk] : [];
  });
  protected readonly ready = computed(() => allowedPair(this.risk(), this.action()));

  protected chooseRisk(risk: Risk): void {
    this.risk.set(risk);
    const allowed = ALLOWED_ACTIONS[risk];
    // A single possible action is no choice (READ_ONLY has only read); with two the administrator picks.
    this.action.set(
      allowed.length === 1 ? allowed[0] : allowed.includes(this.action()!) ? this.action() : null,
    );
  }

  protected chooseAction(action: ToolAction): void {
    this.action.set(action);
  }

  protected confirm(): void {
    const risk = this.risk();
    const action = this.action();
    if (risk && action && allowedPair(risk, action)) {
      this.dialogRef.close({ risk, action });
    }
  }
}
