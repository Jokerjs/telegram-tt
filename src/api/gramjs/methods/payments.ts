import BigInt from 'big-integer';
import { Api as GramJs } from '../../../lib/gramjs';

import type {
  ApiChat, ApiInputStorePaymentPurpose, ApiPeer, ApiRequestInputInvoice,
  ApiThemeParameters,
} from '../../types';

import { DEBUG } from '../../../config';
import {
  buildApiBoost,
  buildApiBoostsStatus,
  buildApiCheckedGiftCode,
  buildApiGiveawayInfo,
  buildApiInvoiceFromForm,
  buildApiMyBoost,
  buildApiPaymentForm,
  buildApiPremiumGiftCodeOption,
  buildApiPremiumPromo,
  buildApiReceipt,
  buildApiStarsGiftOptions,
  buildApiStarsGiveawayOptions,
  buildApiStarsTransaction,
  buildApiStarTopupOption,
  buildShippingOptions,
} from '../apiBuilders/payments';
import {
  buildInputInvoice, buildInputPeer, buildInputStorePaymentPurpose, buildInputThemeParams, buildShippingInfo,
} from '../gramjsBuilders';
import {
  addWebDocumentToLocalDb,
  deserializeBytes,
  serializeBytes,
} from '../helpers';
import localDb from '../localDb';
import { sendApiUpdate } from '../updates/apiUpdateEmitter';
import { handleGramJsUpdate, invokeRequest } from './client';
import { getTemporaryPaymentPassword } from './twoFaSettings';

export async function validateRequestedInfo({
  inputInvoice,
  requestInfo,
  shouldSave,
}: {
  inputInvoice: ApiRequestInputInvoice;
  requestInfo: GramJs.TypePaymentRequestedInfo;
  shouldSave?: boolean;
}): Promise<{
    id: string;
    shippingOptions: any;
  } | undefined> {
  const result = await invokeRequest(new GramJs.payments.ValidateRequestedInfo({
    invoice: buildInputInvoice(inputInvoice),
    save: shouldSave || undefined,
    info: buildShippingInfo(requestInfo),
  }));
  if (!result) {
    return undefined;
  }

  const { id, shippingOptions } = result;
  if (!id) {
    return undefined;
  }

  return {
    id,
    shippingOptions: buildShippingOptions(shippingOptions),
  };
}

export async function sendPaymentForm({
  inputInvoice,
  formId,
  requestedInfoId,
  shippingOptionId,
  credentials,
  savedCredentialId,
  temporaryPassword,
  tipAmount,
}: {
  inputInvoice: ApiRequestInputInvoice;
  formId: string;
  credentials: any;
  requestedInfoId?: string;
  shippingOptionId?: string;
  savedCredentialId?: string;
  temporaryPassword?: string;
  tipAmount?: number;
}) {
  const inputCredentials = temporaryPassword && savedCredentialId
    ? new GramJs.InputPaymentCredentialsSaved({
      id: savedCredentialId,
      tmpPassword: deserializeBytes(temporaryPassword),
    })
    : new GramJs.InputPaymentCredentials({
      save: credentials.save,
      data: new GramJs.DataJSON({ data: JSON.stringify(credentials.data) }),
    });
  const result = await invokeRequest(new GramJs.payments.SendPaymentForm({
    formId: BigInt(formId),
    invoice: buildInputInvoice(inputInvoice),
    requestedInfoId,
    shippingOptionId,
    credentials: inputCredentials,
    ...(tipAmount && { tipAmount: BigInt(tipAmount) }),
  }));

  if (!result) return false;

  if (result instanceof GramJs.payments.PaymentVerificationNeeded) {
    sendApiUpdate({
      '@type': 'updatePaymentVerificationNeeded',
      url: result.url,
    });

    return undefined;
  } else {
    handleGramJsUpdate(result.updates);
  }

  return Boolean(result);
}

export async function sendStarPaymentForm({
  formId,
  inputInvoice,
}: {
  formId: string;
  inputInvoice: ApiRequestInputInvoice;
}) {
  const result = await invokeRequest(new GramJs.payments.SendStarsForm({
    formId: BigInt(formId),
    invoice: buildInputInvoice(inputInvoice),
  }));

  if (!result) return false;

  if (result instanceof GramJs.payments.PaymentVerificationNeeded) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn('Unexpected PaymentVerificationNeeded in sendStarsForm');
    }

    return undefined;
  } else {
    handleGramJsUpdate(result.updates);
  }

  return Boolean(result);
}

export async function getPaymentForm(inputInvoice: ApiRequestInputInvoice, theme?: ApiThemeParameters) {
  const result = await invokeRequest(new GramJs.payments.GetPaymentForm({
    invoice: buildInputInvoice(inputInvoice),
    themeParams: theme ? buildInputThemeParams(theme) : undefined,
  }));

  if (!result) {
    return undefined;
  }

  if (result.photo) {
    addWebDocumentToLocalDb(result.photo);
  }

  return {
    form: buildApiPaymentForm(result),
    invoice: buildApiInvoiceFromForm(result),
  };
}

export async function getReceipt(chat: ApiChat, msgId: number) {
  const result = await invokeRequest(new GramJs.payments.GetPaymentReceipt({
    peer: buildInputPeer(chat.id, chat.accessHash),
    msgId,
  }));

  if (!result) {
    return undefined;
  }

  return {
    receipt: buildApiReceipt(result),
  };
}

export async function fetchPremiumPromo() {
  const result = await invokeRequest(new GramJs.help.GetPremiumPromo());
  if (!result) return undefined;

  result.videos.forEach((video) => {
    if (video instanceof GramJs.Document) {
      localDb.documents[video.id.toString()] = video;
    }
  });

  return {
    promo: buildApiPremiumPromo(result),
  };
}

export async function fetchTemporaryPaymentPassword(password: string) {
  const result = await getTemporaryPaymentPassword(password);

  if (!result) {
    return undefined;
  }

  if ('error' in result) {
    return result;
  }

  return {
    value: serializeBytes(result.tmpPassword),
    validUntil: result.validUntil,
  };
}

export async function fetchMyBoosts() {
  const result = await invokeRequest(new GramJs.premium.GetMyBoosts());

  if (!result) return undefined;

  const boosts = result.myBoosts.map(buildApiMyBoost);

  return {
    boosts,
  };
}

export async function applyBoost({
  chat,
  slots,
} : {
  chat: ApiChat;
  slots: number[];
}) {
  const result = await invokeRequest(new GramJs.premium.ApplyBoost({
    peer: buildInputPeer(chat.id, chat.accessHash),
    slots,
  }));

  if (!result) return undefined;

  const boosts = result.myBoosts.map(buildApiMyBoost);

  return {
    boosts,
  };
}

export async function fetchBoostStatus({
  chat,
}: {
  chat: ApiChat;
}) {
  const result = await invokeRequest(new GramJs.premium.GetBoostsStatus({
    peer: buildInputPeer(chat.id, chat.accessHash),
  }));

  if (!result) {
    return undefined;
  }

  return buildApiBoostsStatus(result);
}

export async function fetchBoostList({
  chat,
  isGifts,
  offset = '',
  limit,
}: {
  chat: ApiChat;
  isGifts?: boolean;
  offset?: string;
  limit?: number;
}) {
  const result = await invokeRequest(new GramJs.premium.GetBoostsList({
    peer: buildInputPeer(chat.id, chat.accessHash),
    gifts: isGifts || undefined,
    offset,
    limit,
  }));

  if (!result) {
    return undefined;
  }

  const boostList = result.boosts.map(buildApiBoost);

  return {
    count: result.count,
    boostList,
    nextOffset: result.nextOffset,
  };
}

export async function fetchGiveawayInfo({
  peer,
  messageId,
}: {
  peer: ApiPeer;
  messageId: number;
}) {
  const result = await invokeRequest(new GramJs.payments.GetGiveawayInfo({
    peer: buildInputPeer(peer.id, peer.accessHash),
    msgId: messageId,
  }));

  if (!result) {
    return undefined;
  }

  return buildApiGiveawayInfo(result);
}

export async function checkGiftCode({
  slug,
}: {
  slug: string;
}) {
  const result = await invokeRequest(new GramJs.payments.CheckGiftCode({
    slug,
  }));

  if (!result) {
    return undefined;
  }

  return {
    code: buildApiCheckedGiftCode(result),
  };
}

export function applyGiftCode({
  slug,
}: {
  slug: string;
}) {
  return invokeRequest(new GramJs.payments.ApplyGiftCode({
    slug,
  }), {
    shouldReturnTrue: true,
  });
}

export async function getPremiumGiftCodeOptions({
  chat,
}: {
  chat?: ApiChat;
}) {
  const result = await invokeRequest(new GramJs.payments.GetPremiumGiftCodeOptions({
    boostPeer: chat && buildInputPeer(chat.id, chat.accessHash),
  }));

  if (!result) {
    return undefined;
  }

  return result.map(buildApiPremiumGiftCodeOption);
}

export async function getStarsGiftOptions({
  chat,
}: {
  chat?: ApiChat;
}) {
  const result = await invokeRequest(new GramJs.payments.GetStarsGiftOptions({
    userId: chat && buildInputPeer(chat.id, chat.accessHash),
  }));

  if (!result) {
    return undefined;
  }

  return result.map(buildApiStarsGiftOptions);
}

export async function fetchStarsGiveawayOptions() {
  const result = await invokeRequest(new GramJs.payments.GetStarsGiveawayOptions());

  if (!result) {
    return undefined;
  }

  return result.map(buildApiStarsGiveawayOptions);
}

export function launchPrepaidGiveaway({
  chat,
  giveawayId,
  paymentPurpose,
}: {
  chat: ApiChat;
  giveawayId: string;
  paymentPurpose: ApiInputStorePaymentPurpose;
}) {
  return invokeRequest(new GramJs.payments.LaunchPrepaidGiveaway({
    peer: buildInputPeer(chat.id, chat.accessHash),
    giveawayId: BigInt(giveawayId),
    purpose: buildInputStorePaymentPurpose(paymentPurpose),
  }), {
    shouldReturnTrue: true,
  });
}

export async function fetchStarsStatus() {
  const result = await invokeRequest(new GramJs.payments.GetStarsStatus({
    peer: new GramJs.InputPeerSelf(),
  }));

  if (!result) {
    return undefined;
  }

  return {
    nextOffset: result.nextOffset,
    history: result.history?.map(buildApiStarsTransaction),
    balance: result.balance.toJSNumber(),
  };
}

export async function fetchStarsTransactions({
  peer,
  offset,
  isInbound,
  isOutbound,
}: {
  peer?: ApiPeer;
  offset?: string;
  isInbound?: true;
  isOutbound?: true;
}) {
  const inputPeer = peer ? buildInputPeer(peer.id, peer.accessHash) : new GramJs.InputPeerSelf();
  const result = await invokeRequest(new GramJs.payments.GetStarsTransactions({
    peer: inputPeer,
    offset,
    inbound: isInbound,
    outbound: isOutbound,
  }));

  if (!result) {
    return undefined;
  }

  return {
    nextOffset: result.nextOffset,
    history: result.history?.map(buildApiStarsTransaction),
    balance: result.balance.toJSNumber(),
  };
}

export async function fetchStarsTransactionById({
  id, peer,
}: {
  id: string;
  peer?: ApiPeer;
}) {
  const inputPeer = peer ? buildInputPeer(peer.id, peer.accessHash) : new GramJs.InputPeerSelf();
  const result = await invokeRequest(new GramJs.payments.GetStarsTransactionsByID({
    peer: inputPeer,
    id: [new GramJs.InputStarsTransaction({
      id,
    })],
  }));

  if (!result?.history?.[0]) {
    return undefined;
  }

  return {
    transaction: buildApiStarsTransaction(result.history[0]),
  };
}

export async function fetchStarsTopupOptions() {
  const result = await invokeRequest(new GramJs.payments.GetStarsTopupOptions());

  if (!result) {
    return undefined;
  }

  return result.map(buildApiStarTopupOption);
}