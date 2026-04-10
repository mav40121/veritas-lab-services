import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  children: React.ReactNode; // the trigger element
  destructive?: boolean;
}

/**
 * ConfirmDialog -- wrap any trigger element to gate it behind a confirmation dialog.
 *
 * Usage:
 *   <ConfirmDialog message="Delete this task?" onConfirm={() => deleteTask.mutate()}>
 *     <Button variant="ghost">Delete</Button>
 *   </ConfirmDialog>
 *
 * The trigger element is cloned with an onClick that opens the dialog.
 * onConfirm is only called when the user clicks the confirm button.
 */
export function ConfirmDialog({
  title = "Are you sure?",
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  children,
  destructive = true,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Cloning the trigger so callers don't need to manage open state */}
      <span
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        style={{ display: "contents" }}
      >
        {children}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {cancelLabel}
            </Button>
            <Button
              size="sm"
              variant={destructive ? "destructive" : "default"}
              onClick={() => { onConfirm(); setOpen(false); }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
