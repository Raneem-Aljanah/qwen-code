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

export const doctorCommand: SlashCommand = {
  name: 'doctor',
  get description() {
    return t('Run installation and environment diagnostics');
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive', 'non_interactive', 'acp'] as const,
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
      action: memoryDoctorAction,
    },
  ],
};

async function memoryDoctorAction(_context: CommandContext, args = '') {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const diagnostics = await collectMemoryDiagnostics();
  return {
    type: 'message' as const,
    messageType: 'info' as const,
    content: tokens.includes('--json')
      ? JSON.stringify(diagnostics, null, 2)
      : formatMemoryDiagnostics(diagnostics),
  };
}

function formatMemoryDiagnostics(diagnostics: MemoryDiagnostics): string {
  const risks =
    diagnostics.analysis.risks.length > 0
      ? diagnostics.analysis.risks
          .map((risk) => `  - ${risk.type}: ${risk.message}`)
          .join('\n')
      : '  none';

  return [
    'Memory Diagnostics',
    `timestamp: ${diagnostics.timestamp}`,
    `uptimeSeconds: ${diagnostics.uptimeSeconds.toFixed(1)}`,
    `heapUsed: ${formatBytes(diagnostics.memoryUsage.heapUsed)}`,
    `heapTotal: ${formatBytes(diagnostics.memoryUsage.heapTotal)}`,
    `rss: ${formatBytes(diagnostics.memoryUsage.rss)}`,
    `external: ${formatBytes(diagnostics.memoryUsage.external)}`,
    `arrayBuffers: ${formatBytes(diagnostics.memoryUsage.arrayBuffers)}`,
    `v8HeapLimit: ${formatBytes(diagnostics.v8HeapStats.heapSizeLimit)}`,
    `activeHandles: ${diagnostics.activeHandles}`,
    `activeRequests: ${diagnostics.activeRequests}`,
    `openFileDescriptors: ${diagnostics.openFileDescriptors ?? 'unavailable'}`,
    'risks:',
    risks,
    `recommendation: ${diagnostics.analysis.recommendation}`,
  ].join('\n');
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
