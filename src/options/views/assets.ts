/**
 * Asset library — ADR 0010 E3: files added once, stored content-addressed (sha256) in IndexedDB,
 * referenced by name from file-typed columns; sizes checked before filling (spec §16.3).
 */

import { clear, h } from '@/shared/dom';
import { fmtSize } from '@/shared/format';
import { t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import type { Asset } from '@/shared/model';
import { deleteAsset, listAssets, putAsset, storageEstimate } from '@/shared/repo';
import { referencedAssetShas } from '@/shared/storage';

export async function imageDims(file: Blob): Promise<{ width: number; height: number } | undefined> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return undefined;
  try {
    const bmp = await createImageBitmap(file);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dims;
  } catch {
    return undefined;
  }
}

export async function renderAssets(root: HTMLElement): Promise<void> {
  clear(root);
  const list = h('div', { class: 'table-scroll' });
  const status = h('p', { class: 'muted', role: 'status' });
  const input = h('input', { type: 'file', class: 'input', multiple: true }) as HTMLInputElement;

  const refresh = async (prefix = ''): Promise<void> => {
    const assets = (await listAssets()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const used = await referencedAssetShas();
    clear(list);
    if (assets.length === 0) list.append(h('p', { class: 'muted' }, t('assetEmpty')));
    else
      list.append(
        h(
          'table',
          { class: 'table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, t('assetColName')),
              h('th', {}, t('assetColType')),
              h('th', {}, t('assetColSize')),
              h('th', {}, t('assetColDims')),
              h('th', {}, t('assetColId')),
              h('th', {}, t('assetColUsed')),
              h('th', {}, ''),
            ),
          ),
          h(
            'tbody',
            {},
            ...assets.map((a: Asset) =>
              h(
                'tr',
                {},
                h('td', {}, a.name),
                h('td', {}, a.mime),
                h('td', {}, fmtSize(a.size)),
                h('td', {}, a.width && a.height ? `${a.width}×${a.height}` : '—'),
                h('td', {}, h('code', { class: 'muted', title: t('assetShaTitle', a.sha256) }, a.sha256.slice(0, 8))),
                h(
                  'td',
                  {},
                  used.has(a.sha256)
                    ? h('span', { class: 'badge badge--sm badge--success' }, t('assetInUse'))
                    : h('span', { class: 'muted' }, t('assetUnused')),
                ),
                h(
                  'td',
                  {},
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'btn-icon btn-icon--compact btn-icon--danger-hover',
                      'aria-label': t('assetDeleteAria', a.name),
                      disabled: used.has(a.sha256),
                      title: used.has(a.sha256) ? t('assetDeleteBlocked') : t('assetDeleteTitle'),
                      onclick: async () => {
                        await deleteAsset(a.sha256);
                        // The gap before the storage line stays in code — a trailing space does not survive translation.
                        await refresh(`${t('assetDeleted', a.name)} `);
                      },
                    },
                    svgIcon('trash'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    const est = await storageEstimate();
    status.textContent = `${prefix}${est ? t('assetStorageUsed', fmtSize(est.usage), fmtSize(est.quota)) : ''}`;
  };

  input.addEventListener('change', async () => {
    let added = 0;
    for (const f of Array.from(input.files ?? [])) {
      await putAsset(f, f.name, await imageDims(f));
      added++;
    }
    input.value = '';
    await refresh(`${tn(added, 'assetAdded')} `);
  });

  root.append(
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card__body' },
        h('h2', { class: 'card__title' }, t('assetTitle')),
        h('p', { class: 'muted' }, t('assetIntro')),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, t('assetAdd')), input),
        list,
        status,
      ),
    ),
  );
  await refresh();
  root.querySelector('.card__body')?.prepend(h('span', { hidden: true }, svgIcon('upload')));
}
