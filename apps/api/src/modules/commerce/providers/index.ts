import type { AppConfig } from '../../../config/env.js';
import { createAppleIapVerifier, createGoogleIapVerifier } from './iap.js';
import { createMockGateway, createMockIapVerifier } from './mock.js';
import { createPortOneGateway } from './portone.js';
import { createTossGateway } from './toss.js';
import type { IapVerifier, PaymentGateway } from './types.js';

export interface Gateways {
  /** 웹 결제에 사용할 기본 게이트웨이 (PAYMENT_PROVIDER) */
  active: PaymentGateway;
  byId: Record<PaymentGateway['id'], PaymentGateway>;
  iap: Record<'ios' | 'android', IapVerifier>;
}

export function createGateways(config: AppConfig): Gateways {
  const byId = { mock: createMockGateway(), toss: createTossGateway(config), portone: createPortOneGateway(config) };
  const mockIap = config.PAYMENT_PROVIDER === 'mock' && !config.isProd;
  return {
    active: byId[config.PAYMENT_PROVIDER],
    byId,
    iap: {
      ios: mockIap && !config.features.appleIap ? createMockIapVerifier('ios') : createAppleIapVerifier(config),
      android: mockIap && !config.features.googleIap ? createMockIapVerifier('android') : createGoogleIapVerifier(config),
    },
  };
}
