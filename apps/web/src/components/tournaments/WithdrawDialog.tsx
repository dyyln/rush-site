"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { LocalTime } from "./LocalTime";
import styles from "./WithdrawDialog.module.css";

type WithdrawDialogProps = {
  open: boolean;
  cupName: string;
  startsAt: string;
  // True once the bracket exists. Withdrawing then forfeits
  bracketBuilt: boolean;
  teamCup: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function WithdrawDialog({ open, cupName, startsAt, bracketBuilt, teamCup, busy, onConfirm, onClose }: WithdrawDialogProps) {
  const who = teamCup ? "your team" : "you";
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={bracketBuilt ? "Forfeit and withdraw?" : "Withdraw from this cup?"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Stay entered
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {bracketBuilt ? "Forfeit and withdraw" : "Withdraw"}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p>
          This removes {who} from <strong>{cupName}</strong>.
        </p>
        <dl className={styles.facts}>
          <div>
            <dt>Free withdraw until</dt>
            <dd>
              <LocalTime iso={startsAt} />
            </dd>
          </div>
        </dl>
        {bracketBuilt ? (
          <p className={styles.warn} role="note">
            The bracket is already built. Withdrawing now counts as a forfeit and {who} cannot re-enter.
          </p>
        ) : (
          <p className={styles.muted}>
            The bracket is built at the start time. After that, withdrawing counts as a forfeit of {teamCup ? "your team's" : "your"} next
            match.
            {teamCup && " Your teammates are withdrawn too."}
          </p>
        )}
      </div>
    </Modal>
  );
}
