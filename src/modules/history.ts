// 撤销/重做管理：维护项目快照栈、元操作信息，并通过事件总线驱动状态回放。
import { appEventBus } from "./eventBus";
import type { MetaAction, Snapshot } from "../types/historyTypes.js";
import type { ProjectState } from "../types/historyTypes.js";

export class HistoryManager {
  private snapshots: Snapshot[] = [];
  private undoSteps = 0;
  private applying = false;
  private uidCounter = 0;
  private readonly MAX = 6;

  reset() {
    this.snapshots = [];
    this.undoSteps = 0;
    this.applying = false;
    this.uidCounter = 0;
  }

  push(data: ProjectState, action: MetaAction) {
    const snapshot: Snapshot = { data, action, uid: ++this.uidCounter };
    console.log("[HistoryManager] push snapshot:", snapshot);
    if (this.applying) return;
    if (this.undoSteps > 0) {
      this.snapshots.splice(this.snapshots.length - this.undoSteps, this.undoSteps);
      this.undoSteps = 0;
    }
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.MAX) {
      this.snapshots.splice(0, this.snapshots.length - this.MAX);
    }
  }

  canUndo() {
    return this.snapshots.length - this.undoSteps > 1;
  }
  canRedo() {
    return this.undoSteps > 0;
  }

  undo() {
    if (!this.canUndo()) return;
    this.undoSteps += 1;
    this.emitSnapshot();
  }

  applySnapshot(snapUid: number) {
    if (this.applying) return;
    const index = this.snapshots.findIndex(s => s.uid === snapUid);
    if (index === -1) {
      console.warn(`[HistoryManager] Snapshot with uid ${snapUid} not found.`);
      return;
    }
    const targetUndoSteps = this.snapshots.length - 1 - index;
    // 判断是不是当前状态
    if (targetUndoSteps === this.undoSteps) return;
    this.undoSteps = targetUndoSteps;
    this.emitSnapshot();
  }

  redo() {
    if (!this.canRedo()) return;
    this.undoSteps -= 1;
    this.emitSnapshot();
  }

  current(): Snapshot | null {
    if (!this.snapshots.length) return null;
    return this.snapshots[this.snapshots.length - 1 - this.undoSteps];
  }

  getSnapshots() {
    return [...this.snapshots];
  }

  getUndoSteps() {
    return this.undoSteps;
  }

  markApplied(action: MetaAction) {
    this.applying = false;
    appEventBus.emit("historyApplied", action);
  }

  private emitSnapshot() {
    const snap = this.current();
    if (!snap) return;
    this.applying = true;
    appEventBus.emit("historyApplySnapshot", snap);
  }
}

export const historyManager = new HistoryManager();
