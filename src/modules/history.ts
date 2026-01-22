// 撤销/重做管理：维护项目快照栈、元操作信息，并通过事件总线驱动状态回放。
import { appEventBus } from "./eventBus";
import type { MetaAction, Snapshot } from "../types/historyTypes.js";
import type { ProjectState } from "../types/historyTypes.js";

export class HistoryManager {
  private snapshots: Snapshot[] = [];
  private undoSteps = 0;
  private applying = false;
  private uidCounter = 0;
  private readonly MAX = 10;

  reset() {
    // console.log("[HistoryManager] Resetting history manager.");
    this.snapshots = [];
    this.undoSteps = 0;
    this.applying = false;
    this.uidCounter = 0;
  }

  push(data: ProjectState, action: MetaAction): number {
    // console.log("[HistoryManager] Attempting to push new snapshot:", action, "applying =", this.applying, "snapshots.length =", this.snapshots.length, "undoSteps =", this.undoSteps);
    if (this.applying) return -1;
    const lastSnap = this.snapshots[this.snapshots.length - 1];
    let snapshot: Snapshot = { data, action, uid: ++this.uidCounter };

    const canStack =
      lastSnap &&
      lastSnap.action?.name === action.name &&
      lastSnap.action?.payload &&
      action.payload &&
      typeof (action.payload as any).stack === "function";

    if (canStack) {
      const stackedAction = (action.payload as any).stack(lastSnap.action, action);
      if (stackedAction !== undefined) {
        this.snapshots.pop();
        snapshot = { data, action: stackedAction, uid: ++this.uidCounter };
      }
    }

    // console.log("[HistoryManager] push snapshot:", snapshot);
    if (this.undoSteps > 0) {
      const erasedHistoryUid = this.snapshots.splice(this.snapshots.length - this.undoSteps, this.undoSteps).map(s => s.uid);
      this.undoSteps = 0;
      // console.log(`[HistoryManager] Erased old snapshots with uids:`, erasedHistoryUid, `total snap count now:`, this.snapshots.length);
      appEventBus.emit("historyErased", erasedHistoryUid);
    }
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.MAX) {
      this.snapshots.splice(0, this.snapshots.length - this.MAX);
    }

    // console.log(`[HistoryManager] New snapshot pushed. Total snapshots: ${this.snapshots.length}, undoSteps: ${this.undoSteps}`);
    return snapshot.uid;
  }

  // canUndo() {
  //   return this.snapshots.length - this.undoSteps > 1;
  // }
  // canRedo() {
  //   return this.undoSteps > 0;
  // }

  // undo() {
  //   if (!this.canUndo()) return;
  //   this.undoSteps += 1;
  //   this.emitSnapshot("undo", []);
  // }

  // redo() {
  //   if (!this.canRedo()) return;
  //   this.undoSteps -= 1;
  //   this.emitSnapshot("redo", []);
  // }

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
    const direction = targetUndoSteps > this.undoSteps ? "undo" : "redo";
    const snapPassed: number[] = [];
    if (direction === "undo") {
      for (let i = this.snapshots.length - 1 - this.undoSteps; i > index; i--) {
        snapPassed.push(this.snapshots[i].uid);
      }
    } else {
      for (let i = this.snapshots.length - 1 - this.undoSteps; i < index; i++) {
        snapPassed.push(this.snapshots[i].uid);
      }
    }
    this.undoSteps = targetUndoSteps;
    this.emitSnapshot(direction, snapPassed);
  }

  current(): Snapshot | null {
    if (!this.snapshots.length) return null;
    return this.snapshots[this.snapshots.length - 1 - this.undoSteps];
  }

  getCurrentSnapshotUid(): number | null {
    const currentSnap = this.current();
    return currentSnap ? currentSnap.uid : null;
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

  private emitSnapshot(direction: "undo" | "redo", snapPassed: number[] = []) {
    const snap = this.current();
    if (!snap) return;
    snapPassed.push(snap.uid);
    this.applying = true;
    appEventBus.emit("historyApplySnapshot", { current: snap, direction, snapPassed });
  }
}

export const historyManager = new HistoryManager();
