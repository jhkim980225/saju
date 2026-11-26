/**
 * 웹 약관·처리방침 본문 — 문의처 우선순위(서버 SUPPORT_EMAIL → 사업자 이메일), 위탁·국외 이전 목록, 공지 통로 문구.
 */
import { describe, expect, it } from 'vitest';
import { BUSINESS, webPrivacy, webTerms, type BusinessInfo } from '../legal';

const EMPTY: BusinessInfo = { ...BUSINESS, NAME: '', REPRESENTATIVE: '', REG_NO: '', MAIL_ORDER_NO: '', ADDRESS: '', EMAIL: '', PHONE: '', PRIVACY_OFFICER: '' };
const text = (body: string[]) => body.join('\n');

describe('문의처', () => {
  it('서버 SUPPORT_EMAIL 이 있으면 사업자 이메일보다 먼저 쓴다', () => {
    const b = { ...EMPTY, EMAIL: 'biz@example.com' };
    expect(text(webTerms(b, 'help@example.com').body)).toContain('이메일(help@example.com)');
    expect(text(webTerms(b, 'help@example.com').body)).not.toContain('이메일(biz@example.com)'); // 사업자 정보 줄에는 사업자 이메일이 그대로 나온다
    expect(text(webPrivacy(b, 'help@example.com').body)).toContain('이메일(help@example.com)');
  });

  it('서버 값이 없으면 사업자 이메일, 둘 다 없으면 화면 안내', () => {
    expect(text(webTerms({ ...EMPTY, EMAIL: 'biz@example.com' }, null).body)).toContain('이메일(biz@example.com)');
    expect(text(webTerms(EMPTY).body)).toContain('서비스 안의 문의 안내');
  });
});

describe('처리방침', () => {
  it('위탁·국외 이전에 FCM 과 AdMob 이 있고, 공유에는 이름을 넣지 않는다고 적는다', () => {
    const body = text(webPrivacy(EMPTY).body);
    expect(body).toContain('Firebase Cloud Messaging');
    expect(body).toContain('AdMob');
    expect(body).toContain('이름과 생년월일, 태어난 시각은 공유하지 않습니다');
  });

  it('약관·처리방침 변경은 화면 위쪽 공지로 알린다고 적는다', () => {
    expect(text(webTerms(EMPTY).body)).toContain('서비스 화면 위쪽의 공지로 알립니다');
    expect(text(webPrivacy(EMPTY).body)).toContain('서비스 화면 위쪽의 공지로 알립니다');
  });
});
