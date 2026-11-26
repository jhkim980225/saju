/**
 * 비회원 결과 저장 — 예전에는 처음 저장한 프로필 ID 를 저장소에 기억해 두고 다른 생년월일·다른 계정에도 그대로 돌려줬고,
 * 관계를 늘 '본인'으로 보내 대표 사주가 바뀌었다. 지금 계정의 목록으로 같은 사주를 찾고, 없으면 새로 만든다.
 */
import type { BirthInputDto, ProfileDto } from '@saju/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FORM } from '../../lib/birth';
import { STORAGE_KEYS, storage } from '../../lib/storage';
import { ResultPage } from '../ResultPage';

const m = vi.hoisted(() => ({
  profiles: vi.fn<() => Promise<ProfileDto[]>>(),
  createProfile: vi.fn<(dto: { name: string; relation: string; birth: unknown }) => Promise<ProfileDto>>(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, reading: () => new Promise<never>(() => undefined), profiles: m.profiles, createProfile: m.createProfile } };
});
vi.mock('../../lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/session')>();
  return { ...actual, ensureSession: async () => undefined };
});

const DTO: BirthInputDto = { calendar: 'solar', year: 1995, month: 3, day: 14, hour: 14, minute: 30, gender: 'female', timeZone: 'Asia/Seoul', longitude: 126.978 };
const profileOf = (id: string, name: string, relation: ProfileDto['relation'], isPrimary: boolean, birth: Partial<ProfileDto['birth']> = {}): ProfileDto => ({
  id,
  name,
  relation,
  isPrimary,
  birth: { calendar: 'solar', year: 1990, month: 1, day: 1, gender: 'male', isLeapMonth: false, hour: null, minute: null, timeZone: 'Asia/Seoul', longitude: 126.978, timeCorrection: 'lmt', ziHourRule: 'nextDay', ...birth },
  cityName: null,
  dayPillar: '甲子',
  zodiac: '말',
  createdAt: '2026-11-01T00:00:00.000Z',
});

function SajuStub() {
  return h('p', null, `저장된 사주 ${useParams().profileId}`);
}

function renderPage(name: string) {
  storage.setJSON(STORAGE_KEYS.birthDraft, { form: { ...EMPTY_FORM, name }, dto: DTO });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(MemoryRouter, { initialEntries: ['/result'] }, h(Routes, null, h(Route, { path: '/result', element: h(ResultPage) }), h(Route, { path: '/saju/:profileId', element: h(SajuStub) }))),
    ),
  );
}

beforeEach(() => {
  m.profiles.mockReset();
  m.createProfile.mockReset();
});
afterEach(() => {
  cleanup();
  storage.remove(STORAGE_KEYS.birthDraft);
  storage.remove('yd.savedDraftProfile');
});

describe('비회원 결과 저장', () => {
  it('예전에 기억한 프로필 ID 를 쓰지 않고, 대표 사주가 있으면 본인이 아닌 사주로 새로 저장한다', async () => {
    storage.set('yd.savedDraftProfile', 'old-profile');
    m.profiles.mockResolvedValue([profileOf('me', '나', 'self', true)]);
    m.createProfile.mockImplementation(async (dto) => profileOf('new-1', dto.name, dto.relation as ProfileDto['relation'], false));
    renderPage('지훈');
    await userEvent.click(screen.getByRole('button', { name: '보관함에 저장' }));
    expect(await screen.findByText('저장된 사주 new-1')).toBeTruthy();
    expect(m.createProfile).toHaveBeenCalledTimes(1);
    expect(m.createProfile.mock.calls[0]![0]).toMatchObject({ name: '지훈', relation: 'other', birth: DTO });
    expect(storage.get('yd.savedDraftProfile')).toBeNull();
  });

  it('지금 계정에 같은 이름·출생 정보의 사주가 있으면 새로 만들지 않고 그 사주로 간다', async () => {
    m.profiles.mockResolvedValue([profileOf('me', '나', 'self', true), profileOf('same', '서윤', 'friend', false, { year: 1995, month: 3, day: 14, gender: 'female', hour: 14, minute: 30 })]);
    renderPage('서윤');
    await userEvent.click(screen.getByRole('button', { name: '보관함에 저장' }));
    expect(await screen.findByText('저장된 사주 same')).toBeTruthy();
    expect(m.createProfile).not.toHaveBeenCalled();
  });

  it('사주가 하나도 없으면 본인으로 저장한다(첫 사주가 대표가 된다)', async () => {
    m.profiles.mockResolvedValue([]);
    m.createProfile.mockImplementation(async (dto) => profileOf('first', dto.name, dto.relation as ProfileDto['relation'], true));
    renderPage('');
    await userEvent.click(screen.getByRole('button', { name: '보관함에 저장' }));
    expect(await screen.findByText('저장된 사주 first')).toBeTruthy();
    expect(m.createProfile.mock.calls[0]![0]).toMatchObject({ name: '나', relation: 'self' });
  });
});
