import type { X509Certificate } from 'node:crypto';
import type { JWTVerifyGetKey } from 'jose';
import type { AppConfig } from '../../../config/env.js';
import { createAppleIapVerifier, createGoogleIapVerifier } from './iap.js';
import { createMockGateway, createMockIapVerifier } from './mock.js';
import { createPortOneGateway } from './portone.js';
import { createAppleNotificationSource, createGoogleRtdnSource } from './storeNotifications.js';
import { createTossGateway } from './toss.js';
import type { IapVerifier, PaymentGateway, StoreNotificationSource } from './types.js';

export interface Gateways {
  /** 웹 결제에 사용할 기본 게이트웨이 (PAYMENT_PROVIDER) */
  active: PaymentGateway;
  byId: Record<PaymentGateway['id'], PaymentGateway>;
  iap: Record<'ios' | 'android', IapVerifier>;
  /** 스토어 서버 알림(환불·취소) — 목업 없음, 키가 없으면 501 */
  notifications: Record<'ios' | 'android', StoreNotificationSource>;
}

/** 테스트용 의존성 주입 (생략 시 실제 값) */
export interface GatewayDeps {
  /** Apple JWS 신뢰 루트. 기본: 내장 Apple Root CA - G3 */
  appleRootCertificates?: readonly X509Certificate[];
  /** Pub/Sub 푸시 OIDC 토큰 검증 키. 기본: Google 공개키(원격 JWKS) */
  googleOidcKeys?: JWTVerifyGetKey;
  /** 인앱결제 영수증 검증기 교체 */
  iap?: Partial<Gateways['iap']>;
}

export function createGateways(config: AppConfig, deps: GatewayDeps = {}): Gateways {
  const byId = { mock: createMockGateway(), toss: createTossGateway(config), portone: createPortOneGateway(config) };
  const mockIap = config.PAYMENT_PROVIDER === 'mock' && !config.isProd;
  const apple = { rootCertificates: deps.appleRootCertificates };
  return {
    active: byId[config.PAYMENT_PROVIDER],
    byId,
    iap: {
      ios: deps.iap?.ios ?? (mockIap && !config.features.appleIap ? createMockIapVerifier('ios') : createAppleIapVerifier(config, apple)),
      android: deps.iap?.android ?? (mockIap && !config.features.googleIap ? createMockIapVerifier('android') : createGoogleIapVerifier(config)),
    },
    notifications: {
      ios: createAppleNotificationSource(config, apple),
      android: createGoogleRtdnSource(config, { oidcKeys: deps.googleOidcKeys }),
    },
  };
}
