/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandContext, SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import type { HistoryItemDoctor } from '../types.js';
import { runDoctorChecks } from '../../utils/doctorChecks.js';
import { t } from '../../i18n/index.js';
import {
  collectMemoryDiagnostics,
  type MemoryDiagnostics,
} from '@qwen-code/qwen-code-core';
import { formatMemoryUsage } from '../utils/formatters.js';

export const doctorCommand: SlashCommand = {
  name: 'doctor',
  get description() {
    return t('Run installation and environment diagnostics');
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive', 'non_interactive', 'acp'] as const,
  // Hint advertises the only subcommand so command pickers surface it; the
  // parent itself still auto-submits because acceptsInput is false.
  argumentHint: '[memory]',
  acceptsInput: false,
  action: async (context) => {
    const executionMode = context.executionMode ?? 'interactive';
    const abortSignal = context.abortSignal;

    if (executionMode === 'interactive') {
      context.ui.setPendingItem({
        type: 'info',
        text: t('Running diagnostics...'),
      });
    }

    try {
      const checks = await runDoctorChecks(context);

      if (abortSignal?.aborted) {
        return;
      }

      const summary = {
        pass: checks.filter((c) => c.status === 'pass').length,
        warn: checks.filter((c) => c.status === 'warn').length,
        fail: checks.filter((c) => c.status === 'fail').length,
      };

      if (executionMode === 'interactive') {
        const doctorItem: Omit<HistoryItemDoctor, 'id'> = {
          type: 'doctor',
          checks,
          summary,
        };
        context.ui.addItem(doctorItem, Date.now());
        return;
      }

      return {
        type: 'message' as const,
        messageType: (summary.fail > 0 ? 'error' : 'info') as 'error' | 'info',
        content: JSON.stringify({ checks, summary }, null, 2),
      };
    } finally {
      if (executionMode === 'interactive') {
        context.ui.setPendingItem(null);
      }
    }
  },
  subCommands: [
    {
      name: 'memory',
      get description() {
        return t('Show current process memory diagnostics');
      },
      kind: CommandKind.BUILT_IN,
      supportedModes: ['interactive', 'non_interactive', 'acp'] as const,
      argumentHint: '[--json]',
      action: memoryDoctorAction,
    },
  ],
};

const MEMORY_USAGE_HINT = '/doctor memory [--json]';

async function memoryDoctorAction(context: CommandContext, args = '') {
  if (context.abortSignal?.aborted) {
    return;
  }

  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const unknown = tokens.filter((token) => token !== '--json');
  if (unknown.length > 0) {
    return {
      type: 'message' as const,
      messageType: 'error' as const,
      content: `${t('Unknown argument(s)')}: ${unknown.join(', ')}. ${t('Usage')}: ${MEMORY_USAGE_HINT}`,
    };
  }

  try {
    const diagnostics = await collectMemoryDiagnostics();

    if (context.abortSignal?.aborted) {
      return;
    }

    return {
      type: 'message' as const,
      messageType: 'info' as const,
      content: tokens.includes('--json')
        ? JSON.stringify(diagnostics, null, 2)
        : formatMemoryDiagnostics(diagnostics),
    };
  } catch (error) {
    if (context.abortSignal?.aborted) {
      return;
    }

    return {
      type: 'message' as const,
      messageType: 'error' as const,
      content: `${t('Failed to collect memory diagnostics')}: ${formatError(error)}`,
    };
  }
}

// resourceUsage CPU times are microseconds; convert to seconds for display.
function formatCpuMicroseconds(micros: number): string {
  return `${(micros / 1_000_000).toFixed(2)}s`;
}

function formatHeapSpaces(
  spaces: MemoryDiagnostics['v8HeapSpaces'],
): string | undefined {
  if (!spaces || spaces.length === 0) {
    return undefined;
  }
  const top = [...spaces].sort((a, b) => b.used - a.used).slice(0, 4);
  const lines = top.map(
    (space) =>
      `  - ${space.name}: used ${formatMemoryUsage(space.used)} / size ${formatMemoryUsage(space.size)}`,
  );
  if (spaces.length > top.length) {
    lines.push(`  - … ${spaces.length - top.length} more`);
  }
  return lines.join('\n');
}

function formatMemoryDiagnostics(diagnostics: MemoryDiagnostics): string {
  const risks =
    diagnostics.analysis.risks.length > 0
      ? diagnostics.analysis.risks
          .map((risk) => `  - ${risk.type}: ${risk.message}`)
          .join('\n')
      : `  ${t('none')}`;

  const lines: string[] = [
    t('Memory Diagnostics'),
    `timestamp: ${diagnostics.timestamp}`,
    `uptimeSeconds: ${diagnostics.uptimeSeconds.toFixed(1)}`,
    `heapUsed: ${formatMemoryUsage(diagnostics.memoryUsage.heapUsed)}`,
    `heapTotal: ${formatMemoryUsage(diagnostics.memoryUsage.heapTotal)}`,
    `rss: ${formatMemoryUsage(diagnostics.memoryUsage.rss)}`,
    `external: ${formatMemoryUsage(diagnostics.memoryUsage.external)}`,
    `arrayBuffers: ${formatMemoryUsage(diagnostics.memoryUsage.arrayBuffers)}`,
    `v8HeapLimit: ${formatMemoryUsage(diagnostics.v8HeapStats.heapSizeLimit)}`,
    `v8MallocedMemory: ${formatMemoryUsage(diagnostics.v8HeapStats.mallocedMemory)}`,
    `v8PeakMallocedMemory: ${formatMemoryUsage(diagnostics.v8HeapStats.peakMallocedMemory)}`,
    `detachedContexts: ${diagnostics.v8HeapStats.detachedContexts}`,
    `nativeContexts: ${diagnostics.v8HeapStats.nativeContexts}`,
    `maxRSS: ${formatMemoryUsage(diagnostics.resourceUsage.maxRSS)}`,
    `userCPUTime: ${formatCpuMicroseconds(diagnostics.resourceUsage.userCPUTime)}`,
    `systemCPUTime: ${formatCpuMicroseconds(diagnostics.resourceUsage.systemCPUTime)}`,
    `activeHandles: ${diagnostics.activeHandles}`,
    `activeRequests: ${diagnostics.activeRequests}`,
    `openFileDescriptors: ${diagnostics.openFileDescriptors ?? t('unavailable')}`,
    `smapsRollup: ${diagnostics.smapsRollup ? t('available') : t('unavailable')}`,
  ];

  const heapSpaces = formatHeapSpaces(diagnostics.v8HeapSpaces);
  if (heapSpaces) {
    lines.push('v8HeapSpaces:', heapSpaces);
  }

  lines.push('risks:', risks, `recommendation: ${diagnostics.analysis.recommendation}`);
  return lines.join('\n');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
