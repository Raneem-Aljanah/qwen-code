/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { doctorCommand } from './doctorCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import * as doctorChecksModule from '../../utils/doctorChecks.js';
import { collectMemoryDiagnostics } from '@qwen-code/qwen-code-core';
import type { DoctorCheckResult } from '../types.js';

vi.mock('../../utils/doctorChecks.js');
vi.mock('@qwen-code/qwen-code-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@qwen-code/qwen-code-core')>()),
  collectMemoryDiagnostics: vi.fn(),
}));

describe('doctorCommand', () => {
  let mockContext: CommandContext;

  const getMemoryCommand = () => {
    const memoryCommand = doctorCommand.subCommands?.find(
      (command) => command.name === 'memory',
    );
    expect(memoryCommand).toBeDefined();
    return memoryCommand!;
  };

  const mockChecks: DoctorCheckResult[] = [
    {
      category: 'System',
      name: 'Node.js version',
      status: 'pass',
      message: 'v20.0.0',
    },
    {
      category: 'Authentication',
      name: 'API key',
      status: 'fail',
      message: 'not configured',
      detail: 'Run /auth to configure authentication.',
    },
  ];

  beforeEach(() => {
    mockContext = createMockCommandContext({
      executionMode: 'interactive',
      ui: {
        addItem: vi.fn(),
        setPendingItem: vi.fn(),
      },
    } as unknown as CommandContext);

    vi.mocked(doctorChecksModule.runDoctorChecks).mockResolvedValue(mockChecks);
    vi.mocked(collectMemoryDiagnostics).mockResolvedValue({
      timestamp: '2026-05-01T10:00:00.000Z',
      uptimeSeconds: 60,
      memoryUsage: {
        heapUsed: 1_000,
        heapTotal: 2_000,
        rss: 3_000,
        external: 100,
        arrayBuffers: 50,
      },
      v8HeapStats: {
        heapSizeLimit: 4_000,
        totalHeapSize: 2_000,
        usedHeapSize: 1_000,
        mallocedMemory: 2_048,
        peakMallocedMemory: 4_096,
        detachedContexts: 0,
        nativeContexts: 1,
      },
      resourceUsage: {
        maxRSS: 4_000,
        userCPUTime: 10,
        systemCPUTime: 20,
      },
      activeHandles: 2,
      activeRequests: 0,
      platform: 'darwin',
      nodeVersion: 'v20.19.0',
      analysis: {
        risks: [],
        recommendation: 'No obvious leak indicators.',
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have the correct name and description', () => {
    expect(doctorCommand.name).toBe('doctor');
    expect(doctorCommand.description).toBe(
      'Run installation and environment diagnostics',
    );
    expect(doctorCommand.acceptsInput).toBe(false);
  });

  it('should show pending item and then add doctor item in interactive mode', async () => {
    await doctorCommand.action!(mockContext, '');

    expect(mockContext.ui.setPendingItem).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Running diagnostics...' }),
    );
    expect(mockContext.ui.setPendingItem).toHaveBeenCalledWith(null);
    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'doctor',
        checks: mockChecks,
        summary: { pass: 1, warn: 0, fail: 1 },
      }),
      expect.any(Number),
    );
  });

  it('should return JSON message in non-interactive mode', async () => {
    mockContext = createMockCommandContext({
      executionMode: 'non_interactive',
      ui: {
        addItem: vi.fn(),
        setPendingItem: vi.fn(),
      },
    } as unknown as CommandContext);

    const result = await doctorCommand.action!(mockContext, '');

    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'error',
      }),
    );
    expect(mockContext.ui.addItem).not.toHaveBeenCalled();
  });

  it('should return info messageType when no failures', async () => {
    vi.mocked(doctorChecksModule.runDoctorChecks).mockResolvedValue([
      {
        category: 'System',
        name: 'Node.js version',
        status: 'pass',
        message: 'v20.0.0',
      },
    ]);

    mockContext = createMockCommandContext({
      executionMode: 'non_interactive',
      ui: {
        addItem: vi.fn(),
        setPendingItem: vi.fn(),
      },
    } as unknown as CommandContext);

    const result = await doctorCommand.action!(mockContext, '');

    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
      }),
    );
  });

  it('should not add item when aborted', async () => {
    const abortController = new AbortController();
    abortController.abort();

    mockContext = createMockCommandContext({
      executionMode: 'interactive',
      abortSignal: abortController.signal,
      ui: {
        addItem: vi.fn(),
        setPendingItem: vi.fn(),
      },
    } as unknown as CommandContext);

    await doctorCommand.action!(mockContext, '');

    expect(mockContext.ui.addItem).not.toHaveBeenCalled();
    // setPendingItem(null) should still be called via finally
    expect(mockContext.ui.setPendingItem).toHaveBeenCalledWith(null);
  });

  it('should return memory diagnostics as JSON for /doctor memory --json', async () => {
    mockContext = createMockCommandContext({
      executionMode: 'non_interactive',
      ui: {
        addItem: vi.fn(),
        setPendingItem: vi.fn(),
      },
    } as unknown as CommandContext);

    const result = await getMemoryCommand().action!(mockContext, '--json');

    expect(doctorChecksModule.runDoctorChecks).not.toHaveBeenCalled();
    expect(collectMemoryDiagnostics).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
      }),
    );
    expect(
      JSON.parse(result?.type === 'message' ? result.content : '{}'),
    ).toMatchObject({
      memoryUsage: {
        heapUsed: 1_000,
      },
      analysis: {
        risks: [],
      },
    });
  });

  it('should return a readable memory diagnostics summary for /doctor memory', async () => {
    mockContext = createMockCommandContext({
      executionMode: 'non_interactive',
      ui: {
        addItem: vi.fn(),
        setPendingItem: vi.fn(),
      },
    } as unknown as CommandContext);

    const result = await getMemoryCommand().action!(mockContext, '');

    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Memory Diagnostics'),
      }),
    );
    expect(result?.type === 'message' ? result.content : '').toContain(
      'heapUsed',
    );
    expect(result?.type === 'message' ? result.content : '').toContain(
      'v8MallocedMemory: 2.0 KB',
    );
  });

  it('should render small memory values without rounding to zero MiB', async () => {
    const result = await getMemoryCommand().action!(mockContext, '');

    expect(result?.type === 'message' ? result.content : '').toContain(
      'heapUsed: 1.0 KB',
    );
    expect(result?.type === 'message' ? result.content : '').not.toContain(
      '0.00 MiB',
    );
  });

  it('should register memory as a real doctor subcommand', () => {
    expect(doctorCommand.subCommands?.map((command) => command.name)).toContain(
      'memory',
    );
    expect(getMemoryCommand().argumentHint).toBe('[--json]');
  });

  it('should render risk indicators without failing memory diagnostics', async () => {
    vi.mocked(collectMemoryDiagnostics).mockResolvedValue({
      timestamp: '2026-05-01T10:00:00.000Z',
      uptimeSeconds: 60,
      memoryUsage: {
        heapUsed: 3_500,
        heapTotal: 4_000,
        rss: 8_000,
        external: 100,
        arrayBuffers: 50,
      },
      v8HeapStats: {
        heapSizeLimit: 4_000,
        totalHeapSize: 4_000,
        usedHeapSize: 3_500,
        mallocedMemory: 10,
        peakMallocedMemory: 20,
        detachedContexts: 0,
        nativeContexts: 1,
      },
      resourceUsage: {
        maxRSS: 8_000,
        userCPUTime: 10,
        systemCPUTime: 20,
      },
      activeHandles: 2,
      activeRequests: 0,
      platform: 'darwin',
      nodeVersion: 'v20.19.0',
      analysis: {
        risks: [{ type: 'heap-pressure', message: 'Heap pressure detected.' }],
        recommendation: 'WARNING: 1 potential leak indicator(s) found.',
      },
    });
    const result = await getMemoryCommand().action!(mockContext, '');

    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
      }),
    );
    expect(result?.type === 'message' ? result.content : '').toContain(
      'heap-pressure: Heap pressure detected.',
    );
  });

  it('should skip memory diagnostics when already aborted', async () => {
    const abortController = new AbortController();
    abortController.abort();
    mockContext = createMockCommandContext({
      executionMode: 'non_interactive',
      abortSignal: abortController.signal,
      ui: {
        addItem: vi.fn(),
        setPendingItem: vi.fn(),
      },
    } as unknown as CommandContext);

    const result = await getMemoryCommand().action!(mockContext, '');

    expect(result).toBeUndefined();
    expect(collectMemoryDiagnostics).not.toHaveBeenCalled();
  });

  it('should return an error message when memory diagnostics fail', async () => {
    vi.mocked(collectMemoryDiagnostics).mockRejectedValueOnce(
      new Error('probe failed'),
    );

    const result = await getMemoryCommand().action!(mockContext, '');

    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('probe failed'),
      }),
    );
  });
});
