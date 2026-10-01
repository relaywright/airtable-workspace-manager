import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackupsPanel } from './BackupsPanel';
import { setupMockApi } from '../test/mocks';

const counts = (created, changed, deleted) => ({
  records: 21,
  created,
  changed,
  deleted,
  filesSaved: 0,
  filesFailed: 0,
});

const productRun = {
  id: 3,
  status: 'complete',
  startedAt: '2026-09-25T10:00:00.000Z',
  finishedAt: '2026-09-25T10:00:05.000Z',
  counts: counts(0, 0, 0),
  error: null,
};

const overview = {
  folder: 'C:\\Users\\demo\\AppData\\Roaming\\Workspace Manager\\backups\\demo',
  isRunning: false,
  bases: [
    {
      baseId: 'appDemoProduct001',
      baseName: 'Product Catalog',
      restorePointCount: 3,
      recordCount: 21,
      fileCount: 4,
      fileBytes: 2400,
      lastRun: productRun,
      lastComplete: productRun,
    },
    {
      baseId: 'appDemoSupplier01',
      baseName: 'Suppliers & Purchasing',
      restorePointCount: 1,
      recordCount: 14,
      fileCount: 0,
      fileBytes: 0,
      lastRun: {
        ...productRun,
        id: 4,
        status: 'incomplete',
        error: {
          code: 'missing-scope',
          message: 'Your Airtable token is not allowed to read this base.',
          helpUrl: 'https://airtable.com/create/tokens',
        },
      },
      lastComplete: { ...productRun, id: 2 },
    },
  ],
};

const restorePoints = [
  { ...productRun, id: 3, counts: counts(0, 0, 0) },
  { ...productRun, id: 2, counts: counts(2, 5, 1) },
];

describe('BackupsPanel', () => {
  let api;

  beforeEach(() => {
    api = setupMockApi({
      getBackupOverview: vi.fn().mockResolvedValue({ success: true, data: overview }),
      getRestorePoints: vi.fn().mockResolvedValue({ success: true, data: restorePoints }),
      backupNow: vi.fn().mockResolvedValue({
        success: true,
        data: { results: [{ status: 'complete' }, { status: 'complete' }] },
      }),
    });
  });

  it('labels Backups as a preview and says restore comes next', async () => {
    await act(async () => {
      render(<BackupsPanel isOpen onClose={() => {}} />);
    });

    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText(/Restoring from a backup arrives in the next release/)).toBeInTheDocument();
  });

  it('lists each base with its counts and the restore points of the selected base', async () => {
    render(<BackupsPanel isOpen onClose={() => {}} />);

    const card = (await screen.findByText('Product Catalog')).closest('[data-testid="backup-card"]');
    expect(within(card).getByText('3 restore points')).toBeInTheDocument();
    expect(within(card).getByText(/21 records · 4 files \(2\.4 KB\)/)).toBeInTheDocument();
    const noFiles = screen.getByText('Suppliers & Purchasing').closest('[data-testid="backup-card"]');
    expect(within(noFiles).getByText('14 records')).toBeInTheDocument();

    expect(await screen.findByText('2 added, 5 changed, 1 deleted')).toBeInTheDocument();
    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(api.getRestorePoints).toHaveBeenCalledWith('appDemoProduct001');
  });

  it('explains a backup that did not finish and links to the token page', async () => {
    render(<BackupsPanel isOpen onClose={() => {}} />);

    expect(await screen.findByText("Last backup didn't finish")).toBeInTheDocument();
    expect(screen.getByText('Your Airtable token is not allowed to read this base.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Airtable token settings' })).toHaveAttribute(
      'href',
      'https://airtable.com/create/tokens',
    );
  });

  it('runs a backup and reloads the list', async () => {
    const user = userEvent.setup();
    render(<BackupsPanel isOpen onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Back up now' }));

    expect(api.backupNow).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Backup finished: 2 bases saved.')).toBeInTheDocument();
    expect(api.getBackupOverview).toHaveBeenCalledTimes(2);
  });

  it("shows why a base didn't finish when the backup can't record it", async () => {
    api.backupNow.mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            baseId: 'appDemoProduct001',
            baseName: 'Product Catalog',
            status: 'incomplete',
            counts: counts(0, 0, 0),
            error: {
              code: 'disk-full',
              message: 'Your backup drive ran out of space, so this backup stopped.',
            },
          },
        ],
      },
    });
    const user = userEvent.setup();
    render(<BackupsPanel isOpen onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Back up now' }));

    expect(await screen.findByText("1 base didn't finish.")).toBeInTheDocument();
    expect(
      screen.getByText('Your backup drive ran out of space, so this backup stopped.'),
    ).toBeInTheDocument();
  });

  it("says when restore points can't be loaded", async () => {
    api.getRestorePoints.mockResolvedValue({ success: false, error: 'Disk read failed.' });
    render(<BackupsPanel isOpen onClose={() => {}} />);

    expect(await screen.findByText(/Couldn't load restore points for Product Catalog/)).toBeInTheDocument();
    expect(screen.queryByText(/No restore points yet/)).not.toBeInTheDocument();
  });

  it('frees the button when a backup that was already running finishes', async () => {
    let emit;
    api.onBackupProgress.mockImplementation((callback) => {
      emit = callback;
      return () => {};
    });
    api.getBackupOverview.mockResolvedValueOnce({ success: true, data: { ...overview, isRunning: true } });
    render(<BackupsPanel isOpen onClose={() => {}} />);

    expect(await screen.findByRole('button', { name: 'Backing up...' })).toBeDisabled();
    act(() => emit({ phase: 'finished', basesDone: 2, basesTotal: 2 }));

    expect(await screen.findByRole('button', { name: 'Back up now' })).toBeEnabled();
    await waitFor(() => expect(api.getRestorePoints).toHaveBeenCalledTimes(2));
  });
});
