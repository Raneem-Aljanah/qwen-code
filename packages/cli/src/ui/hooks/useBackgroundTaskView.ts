/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useBackgroundTaskView — subscribes to the unified `TaskRegistry`
 * (agents + shells + monitors) AND to `MemoryManager` via the dream
 * adapter for dream consolidation tasks. Merges them into a single
 * ordered snapshot of `DialogEntry`s.
 *
 * The registry's `subscribe` fires on every change to any task entry —
 * register, status transition, activity append. The dream adapter
 * surfaces dream task changes through a separate subscription against
 * `MemoryManager`. Both feed the same `refresh` path.
 *
 * Surfaces that only care about live work (the footer pill, the
 * composer's Down-arrow route) filter for `running` themselves.
 */

import { useState, useEffect } from 'react';
import {
  dreamSnapshotSignature,
  listDreamTasks,
  subscribeDreams,
  type AgentTask,
  type Config,
  type DreamTask,
  type TaskState,
} from '@qwen-code/qwen-code-core';

/**
 * @deprecated Use {@link AgentTask} from `@qwen-code/qwen-code-core`
 * directly. Kept as a one-release alias while UI consumers migrate.
 */
export type AgentDialogEntry = AgentTask;

/**
 * @deprecated Renamed to {@link DreamTask}; kept as a one-release alias
 * for UI consumers migrating off the previous local view-model.
 */
export type DreamDialogEntry = DreamTask;

/**
 * A unified view-model entry the dialog/pill/context render against.
 * Discriminated by `kind`; per-kind fields are inlined verbatim so
 * renderer code can stay mechanical (`entry.kind === 'agent'` /
 * `'shell'` / `'monitor'` / `'dream'` guard, then access fields
 * directly).
 *
 * The `agent`/`shell`/`monitor` arms are the core `TaskState` union
 * member, held by `TaskRegistry`. The `dream` arm comes from the
 * dream-task adapter (`tasks/dream-task.ts`), which synthesizes its
 * view-model from `MemoryManager` records.
 */
export type DialogEntry = TaskState | DreamTask;

export interface UseBackgroundTaskViewResult {
  entries: readonly DialogEntry[];
}

/** Stable id of an entry regardless of kind — used as React key + lookup. */
export function entryId(entry: DialogEntry): string {
  switch (entry.kind) {
    case 'agent':
      return entry.agentId;
    case 'shell':
      return entry.shellId;
    case 'monitor':
      return entry.monitorId;
    case 'dream':
      return entry.dreamId;
    default: {
      const _exhaustive: never = entry;
      throw new Error(
        `entryId: unknown DialogEntry kind: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Signature of the registry fields the dialog list / pill renderers
 * depend on: id, kind, status. Activity bursts and event-count bumps
 * mutate in place and don't change this signature, so the hook can
 * suppress the setEntries fan-out for them. Per-entry surfaces
 * (LiveAgentPanel, the dialog's selected-entry tick) carry their own
 * subscriptions.
 *
 * Dream entries are exempt: their dialog-visible fields (progressText,
 * lockReleaseError, metadataWriteError) can change without a status
 * transition, so the dream subscription bypasses this filter and uses
 * `dreamSnapshotSignature` (which advances on any updatedAt bump) for
 * its own dedup.
 */
function registrySnapshotShape(entries: readonly DialogEntry[]): string {
  let sig = '';
  for (const e of entries) {
    if (e.kind === 'dream') continue;
    sig += `${e.kind}:${entryId(e)}:${e.status}|`;
  }
  return sig;
}

export function useBackgroundTaskView(
  config: Config | null,
): UseBackgroundTaskViewResult {
  const [entries, setEntries] = useState<DialogEntry[]>([]);

  useEffect(() => {
    if (!config) return;
    const registry = config.getTaskRegistry();
    const memoryManager = config.getMemoryManager();
    const projectRoot = config.getProjectRoot();
    let lastRegistryShape = '';
    let lastDreamSig = '';

    const buildMerged = (): DialogEntry[] =>
      [
        ...registry.getAll(),
        ...listDreamTasks(memoryManager, projectRoot),
      ].sort((a, b) => a.startTime - b.startTime);

    const initial = buildMerged();
    setEntries(initial);
    lastRegistryShape = registrySnapshotShape(initial);
    lastDreamSig = dreamSnapshotSignature(
      memoryManager.listTasksByType('dream', projectRoot),
    );

    const unsubscribeRegistry = registry.subscribe(() => {
      const merged = buildMerged();
      const shape = registrySnapshotShape(merged);
      if (shape === lastRegistryShape) return;
      lastRegistryShape = shape;
      setEntries(merged);
    });

    const unsubscribeMemory = subscribeDreams(memoryManager, () => {
      const sig = dreamSnapshotSignature(
        memoryManager.listTasksByType('dream', projectRoot),
      );
      if (sig === lastDreamSig) return;
      lastDreamSig = sig;
      setEntries(buildMerged());
    });

    return () => {
      unsubscribeRegistry();
      unsubscribeMemory();
    };
  }, [config]);

  return { entries };
}
