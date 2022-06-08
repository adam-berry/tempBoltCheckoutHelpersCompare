"use strict";

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

/* eslint-disable consistent-return */

/* API Includes */
var StoreMgr = require('dw/catalog/StoreMgr');

var ProductInventoryMgr = require('dw/catalog/ProductInventoryMgr');

var Transaction = require('dw/system/Transaction');

var CustomObjectMgr = require('dw/object/CustomObjectMgr');

var OrderMgr = require('dw/order/OrderMgr');

var Resource = require('dw/web/Resource');
/* Script Modules */


var boltPlaceOrder = require('*/cartridge/scripts/checkout/boltPlaceOrder');

var utils = require('~/cartridge/scripts/util/boltUtils');

var boltBasketUtils = require('*/cartridge/scripts/bolt/basket/utils');

var logUtils = require('~/cartridge/scripts/util/boltLogUtils');

var _require = require('*/cartridge/scripts/util/handleStoreShipment'),
    doesNotRequireShipment = _require.doesNotRequireShipment;

var boltShippingTaxHook = require('*/cartridge/scripts/cart/boltShippingTaxHook');

var _require2 = require('*/cartridge/scripts/bolt/giftcard/purchaseUtils'),
    hasDigitalGiftCards = _require2.hasDigitalGiftCards;
/* Global variables */


var log = logUtils.getLogger('boltCheckoutHelpers');
/**
 * Checking the  basket line items are updated or not
 * @param {Object} currentBasket - current basket
 * @param {Object} req - bolt Request
 * @returns {boolean} true or false
 */

function checkItemQuantity(currentBasket, req) {
  var isItemQuantityMatched = true;
  var allLineItems = currentBasket.productLineItems.length + currentBasket.giftCertificateLineItems.length;
  var boltItems = req.order.cart && req.order.cart.items ? req.order.cart.items.length : 0;

  if (allLineItems !== boltItems) {
    isItemQuantityMatched = false;
  }

  return isItemQuantityMatched;
}
/**
 * Validate basket for checkout
 * @param {Object} basket - current basket
 * @returns {Object} return inventory true or false
 */


function validateProducts(basket) {
  var result = {
    error: false,
    hasInventory: true
  };
  var productLineItems = basket.productLineItems;

  for (var i = 0; i < productLineItems.length; i++) {
    var item = productLineItems[i];

    if (item.product === null || !item.product.online) {
      result.error = true;
      return;
    }

    if (Object.hasOwnProperty.call(item.custom, 'fromStoreId') && item.custom.fromStoreId) {
      var store = StoreMgr.getStore(item.custom.fromStoreId);
      var storeInventory;

      if (Object.hasOwnProperty.call(store.custom, 'inventoryListId')) {
        storeInventory = ProductInventoryMgr.getInventoryList(store.custom.inventoryListId);
      }

      result.hasInventory = storeInventory.getRecord(item.productID) && storeInventory.getRecord(item.productID).ATS.value >= item.quantityValue;
    } else {
      var availabilityLevels = item.product.availabilityModel.getAvailabilityLevels(item.quantityValue);
      result.hasInventory = availabilityLevels.notAvailable.value === 0;
    }
  }

  return result;
}
/**
 * Update shipping method of SFCC cart which is selected in bolt modal
 * @param {Object} cart - cart object
 * @param {Object} req - bolt order hook request object
 */


function updateSelectedShippingMethod(cart, req) {
  // Add shipping method to cart
  if (req && cart.getProductLineItems().length === 0) {
    return;
  }

  var countryCode = req.order.cart.billing_address.country_code;
  var region = req.order.cart.billing_address.region; // for e-gift card purchase, delivery address is set to be the same as billing address

  var address = {
    address1: req.order.cart.billing_address.street_address1 || '',
    address2: req.order.cart.billing_address.street_address2 || '',
    companyName: req.order.cart.billing_address.company || '',
    countryCode: req.order.cart.billing_address.country_code || '',
    stateCode: utils.getStateCode(countryCode, region),
    postalCode: req.order.cart.billing_address.postal_code || '',
    city: req.order.cart.billing_address.locality || '',
    firstName: req.order.cart.billing_address.first_name || '',
    lastName: req.order.cart.billing_address.last_name || '',
    phone: req.order.cart.billing_address.phone || ''
  };
  var productLineItems = cart.getProductLineItems();
  var shippingMethodId = doesNotRequireShipment(productLineItems);
  var hasEgiftCards = hasDigitalGiftCards(productLineItems) || cart.getGiftCertificateLineItems().length > 0;
  var defaultShippingSelected = false;

  if (shippingMethodId) {
    // all items are in store pickup， set address to the store
    var iter = productLineItems.iterator();

    while (iter.hasNext()) {
      var productLineItem = iter.next();
      var storeOrderAddress = productLineItem.getShipment().getShippingAddress();
      var storeAddress = {
        address1: storeOrderAddress.address1 || '',
        address2: storeOrderAddress.address2 || '',
        companyName: storeOrderAddress.companyName || '',
        countryCode: storeOrderAddress.countryCode || '',
        stateCode: utils.getStateCode(countryCode, region),
        postalCode: storeOrderAddress.postalCode || '',
        city: storeOrderAddress.city || '',
        firstName: storeOrderAddress.firstName || '',
        lastName: storeOrderAddress.lastName || '',
        phone: storeOrderAddress.phone || ''
      };
      boltShippingTaxHook.handleShippingSettings(cart, storeAddress); // only set the store address to the default shipping so only need to do it once

      break;
    }

    boltPlaceOrder.handleShippingMethodID(shippingMethodId);
    return;
  }

  if (req.order && req.order.cart.shipments && req.order.cart.shipments.length !== 0) {
    var shippingMethodID = req.order.cart.shipments[0].reference;
    if (!empty(shippingMethodID)) {
      boltPlaceOrder.handleShippingMethodID(shippingMethodID);
      defaultShippingSelected = true;
    }

  } else if (req.cart && req.cart.shipments && req.cart.shipments.length !== 0) {
    var shippingAddress = req.cart.shipments[0].shipping_address;
    var shippingMethod = req.cart.shipments[0].service;

    require('*/cartridge/scripts/checkout/boltPlaceOrder').handleShippingMethod(shippingAddress, shippingMethod);

    defaultShippingSelected = true;
  } else if (req.order && req.order.cart.in_store_shipments && req.order.cart.in_store_shipments !== 0) {
    boltPlaceOrder.handleShippingMethodID('ShipToStore');
    defaultShippingSelected = true;
  } // set the address for gc shipments


  if (hasEgiftCards) {
    boltPlaceOrder.handleGiftCardShipment(address, defaultShippingSelected);
  }
}
/**
 * Prepare billing address from bolt request
 * @param {Object} req - bolt request object
 * @returns {Object} billing address object
 */


function prepareBillingAddress(req) {
  var billingAddress;

  if (req.order.cart && req.order.cart.billing_address) {
    billingAddress = req.order.cart.billing_address;
  } else if (req.from_credit_card && req.from_credit_card.billing_address) {
    billingAddress = req.from_credit_card.billing_address;
  } else {
    var firstName = req.from_consumer.first_name;
    var lastName = req.from_consumer.last_name;
    var phoneNumber = req.from_consumer && req.from_consumer.phones.length !== 0 ? req.from_consumer.phones[0].number : '';
    var emailAddress = req.from_consumer && req.from_consumer.emails.length !== 0 ? req.from_consumer.emails[0].address : '';
    billingAddress = {
      street_address1: '',
      locality: '',
      region: '',
      postal_code: '',
      country_code: '',
      country: '',
      first_name: firstName,
      last_name: lastName,
      phone_number: phoneNumber,
      email_address: emailAddress
    };
  }

  return billingAddress;
}
/**
 * Creates a billing address
 * @param {module:models/CartModel~CartModel} cart - A CartModel wrapping the current Basket.
 * @param {Object} boltBillingAddress - Bolt billing address
 */


function handleBillingAddress(cart, boltBillingAddress) {
  Transaction.wrap(function () {
    var billingAddress = cart.createBillingAddress();
    billingAddress.setFirstName(boltBillingAddress.first_name);
    billingAddress.setLastName(boltBillingAddress.last_name);
    billingAddress.setAddress1(boltBillingAddress.street_address1);
    billingAddress.setAddress2(boltBillingAddress.street_address2 || '');
    billingAddress.setCity(boltBillingAddress.locality);
    billingAddress.setPostalCode(boltBillingAddress.postal_code);
    billingAddress.setStateCode(utils.getStateCode(boltBillingAddress.country_code, boltBillingAddress.region));
    billingAddress.setCountryCode(boltBillingAddress.country_code);
    billingAddress.setPhone(boltBillingAddress.phone_number);
    cart.setCustomerEmail(boltBillingAddress.email_address);
  });
}
/**
 * Get gift certificate code from custom object
 * @param {string} boltLinkOrderID - Bolt link order ID
 * @returns {Array} giftcertificate code array
 */


function getGiftCertificateCode(boltLinkOrderID) {
  var config = utils.getConfiguration();
  var coName = config.dummyOrderCustomObjID;
  var co = CustomObjectMgr.getCustomObject(coName, boltLinkOrderID);
  var giftCertCode = [];

  if (co) {
    try {
      var giftCertificates = co.custom.GiftCertificates;

      if (giftCertificates !== '') {
        giftCertCode = JSON.parse(giftCertificates);
      }
    } catch (e) {
      log.error('Exception occured while getting GC code from custom object :' + e.message);
    }
  }

  return giftCertCode;
}
/**
 * Attempts to create an order from the current basket
 * @param {Object} cart - current basket
 * @param {string} boltLinkOrderID - bolt order reference
 * @returns {Object} The order object created from the current basket
 */


function createOrder(cart, boltLinkOrderID) {
  var order;

  try {
    order = Transaction.wrap(function () {
      return OrderMgr.createOrder(cart, boltLinkOrderID);
    });
  } catch (e) {
    log.error('Exception occurred while creating order: ' + e.message);
    return null;
  }

  return order;
}
/**
 * Create error response format
 * @param {string | number} errorCode - error code
 * @returns {Object} error object
 */


function paseHookErrorCode(errorCode) {
  var errorCodeIntForm = parseInt(errorCode, 10);

  if (isNaN(errorCodeIntForm)) {
    return 0;
  }

  return errorCodeIntForm;
}
/**
 * Create error response format
 * TODO: need to be deprecated
 * @param {number} errorCode - error code
 * @returns {Object} error object
 */


function orderHookErrorResp(errorCode) {
  var output = {
    status: 'failure',
    error: [{
      code: paseHookErrorCode(errorCode),
      data: [{
        reason: utils.getPreAuthErrorMessage(errorCode)
      }]
    }]
  };
  return output;
}
/**
 * Generate Error Response for Create Order Request
 * @param {string} code - error code
 * @param {string} reason - error reason
 * @param {string} requestStr - stringified request
 * @returns {Object} error object
 */


function formatCreateOrderHookErrorResponse(code, reason, requestStr) {
  var dataField = {
    reason: reason
  };

  if (requestStr) {
    dataField = _objectSpread(_objectSpread({}, dataField), {}, {
      requestStr: requestStr
    });
  }

  return {
    status: Resource.msg('create.orderhook.status.failure', 'bolt', null),
    error: [{
      code: parseInt(code, 10),
      data: [dataField]
    }]
  };
}
/**
 * Prepare response for successful order
 * @param {Object} order - order object
 * @param {string} boltLinkOrderID - bolt order reference
 * @returns {Object} response object
 */


function orderHookSuccessResponse(order, boltLinkOrderID) {
  var items = [];

  for (var i = 0; i < order.allProductLineItems.length; i++) {
    var item = order.allProductLineItems[i];
    items.push({
      reference: item.productID,
      name: item.productName,
      sku: item.productID,
      total_amount: item.netPrice.decimalValue * 100,
      unit_price: item.basePrice.decimalValue * 100,
      quantity: item.quantity.value,
      type: 'physical'
    });
  }

  for (var gl = 0; gl < order.allGiftCertificateLineItems.length; gl++) {
    var giftCertificateItem = order.allGiftCertificateLineItems[gl];
    items.push({
      reference: giftCertificateItem.UUID,
      name: giftCertificateItem.lineItemText,
      sku: giftCertificateItem.UUID,
      total_amount: giftCertificateItem.netPrice.decimalValue * 100,
      unit_price: giftCertificateItem.basePrice.decimalValue * 100,
      quantity: 1,
      type: 'digital'
    });
  }

  var billingAddress = {
    street_address1: order.billingAddress.address1,
    street_address2: order.billingAddress.address2,
    locality: order.billingAddress.stateCode,
    region: order.billingAddress.city,
    postal_code: order.billingAddress.postalCode,
    country_code: order.billingAddress.countryCode,
    name: order.billingAddress.fullName,
    first_name: order.billingAddress.firstName,
    last_name: order.billingAddress.lastName,
    phone_number: order.billingAddress.phone
  };
  var shipments = [];

  if (order.allProductLineItems.length !== 0) {
    for (var j = 0; j < order.shipments.length; j++) {
      var shipment = order.shipments[j];
      shipments.push({
        cost: shipment.shippingTotalPrice.value * 100,
        tax_amount: shipment.shippingTotalTax.value * 100,
        service: shipment.shippingMethod ? shipment.shippingMethod.displayName : '',
        reference: shipment.shippingMethod ? shipment.shippingMethod.ID : '',
        shipping_address: {
          street_address1: shipment.shippingAddress.address1,
          street_address2: shipment.shippingAddress.address2 || '',
          locality: shipment.shippingAddress.city,
          region: shipment.shippingAddress.stateCode,
          postal_code: shipment.shippingAddress.postalCode
        }
      });
    }
  }

  var response = {
    status: 'success',
    display_id: order.orderNo,
    order_uuid: order.getUUID(),
    currency: order.currencyCode,
    total: utils.round(order.totalGrossPrice.value * 100),
    order_reference: boltLinkOrderID,
    order: {
      order_reference: boltLinkOrderID,
      display_id: order.orderNo,
      currency: order.currencyCode,
      items: items,
      billing_address: billingAddress,
      shipments: shipments
    }
  };
  return response;
}
/**
 * Clears all forms used in the checkout process.
 */


function clearBoltData() {
  session.privacy.boltLinkOrderID = '';
  session.privacy.boltOrderToken = '';
  session.privacy.boltCheckoutMode = '';
}
/**
 * Remove the unwanted dummy orders that were created when cart gets updated.
 * This logic removes all the dummy orders earlier than yesterday.
 * @param {string} boltLinkOrderID - bolt link order ID
 */


function removeExpiredDummyOrders(boltLinkOrderID) {
  var config = utils.getConfiguration();
  var doCoName = config.dummyOrderCustomObjID; // Removing check to remove yesterday's dummy orders

  var expiredDoCo = CustomObjectMgr.queryCustomObjects(doCoName, 'custom.ID = {0}', 'creationDate desc', boltLinkOrderID);
  var doCo;
  Transaction.begin();

  while (expiredDoCo.hasNext()) {
    doCo = expiredDoCo.next();
    CustomObjectMgr.remove(doCo);
  }

  expiredDoCo.close();
  Transaction.commit();
}
/**
 * Calculate the total valid Gift Certificate discount amount applied in basket
 * @param {dw.order.Basket} basket - session basket object
 * @returns {number} basket total GC amount
 */


function getBasketTotalGCAmount(basket) {
  var gcPayments = basket.getGiftCertificatePaymentInstruments();
  var totalGCAmount = 0;

  for (var i = 0; i < gcPayments.length; i++) {
    totalGCAmount += gcPayments[i].paymentTransaction.amount || 0;
  }

  return totalGCAmount;
}
/**
 * Calculate the totol valid coupon discount amount applied in basket
 * @param {dw.order.Basket} basket - session basket object
 * @returns {number} basket total coupon amount
 */


function getBasketTotalCouponAmount(basket) {
  var couponLineItems = basket.getCouponLineItems();
  var totalCouponAmount = 0;

  for (var i = 0; i < couponLineItems.length; i++) {
    if (!couponLineItems[i].applied || !couponLineItems[i].valid) {
      continue;
    }

    var prices = couponLineItems[i].getPriceAdjustments();

    for (var j = 0; j < prices.length; j++) {
      var couponDiscountAmount = prices[j].basePrice ? prices[j].basePrice.value : 0;
      totalCouponAmount += Math.abs(couponDiscountAmount);
    }
  }

  return totalCouponAmount;
}
/**
 * Validate coupon discounts against Bolt order
 * @param {dw.order.Basket} basket - session basket object
 * @param {Object} cart - bolt cart object
 * @returns {Error | null} basket total coupon amount
 */


function validateCartCouponAmount(basket, cart) {
  var basketTotalCouponAmount = getBasketTotalCouponAmount(basket);
  var totalBoltCouponAmount = 0;

  if (cart.discounts && cart.discounts.length > 0) {
    for (var i = 0; i < cart.discounts.length; i++) {
      var boltDiscount = cart.discounts[i];
      var isCoupon = boltDiscount.discount_category === 'coupon';
      var isMembership = boltDiscount.discount_category === 'membership_discount';

      if (isCoupon || isMembership) {
        totalBoltCouponAmount += boltDiscount.amount.amount;
      }
    }
  } // Return an error if the amounts are off than the 1 cent tolerance


  if (totalBoltCouponAmount > Math.round(basketTotalCouponAmount * 100) + 1 || totalBoltCouponAmount < Math.round(basketTotalCouponAmount * 100) - 1) {
    return new Error('pre-auth coupon amount validation failed for order id ' + cart.order_reference + ', bolt total coupon amoount ' + totalBoltCouponAmount + ' does not match with sfcc total coupon amount ' + basketTotalCouponAmount * 100);
  } // Log 1 cent round-off error


  if (totalBoltCouponAmount !== Math.round(basketTotalCouponAmount * 100)) {
    log.error('rounding error found at pre-auth coupon validation for order id {0}, ' + 'bolt total coupon amount {1} does not match with sfcc total coupon amount {2}', cart.order_reference, totalBoltCouponAmount, basketTotalCouponAmount * 100);
  }

  return null;
}
/**
 * Validate total cart basket amount against Bolt order
 * @param {dw.order.Basket} basket - session basket object
 * @param {Object} cart - bolt cart object
 * @returns {Error | null} basket total coupon amount
 */


function validateCartTotalAmount(basket, cart) {
  var totalGCAmount = getBasketTotalGCAmount(basket);
  var totalGiftCardAmount = boltBasketUtils.getBasketTotalGiftCardPaymentAmounts();

  if (totalGiftCardAmount instanceof Error) {
    return new Error("error while getting basket total gift card payment amount: ".concat(totalGiftCardAmount.message));
  }

  var grossBasketAmount = basket.getTotalGrossPrice().value;
  var grossBasketLessTotalGCAmount = (grossBasketAmount - totalGCAmount - totalGiftCardAmount) * 100; // basket amount without the gift certificate amount, rounded

  var roundedBasketAmountLessGCAmount = Math.round(grossBasketLessTotalGCAmount); // Return an error if the amounts are off than the 1 cent tolerance

  if (cart.total_amount.amount > roundedBasketAmountLessGCAmount + 1 || cart.total_amount.amount < roundedBasketAmountLessGCAmount - 1) {
    return new Error('pre-auth total amount validation failed for order id ' + cart.order_reference + ', bolt total amount ' + cart.total_amount.amount + ' does not match with sfcc total amount ' + grossBasketLessTotalGCAmount + ' [gift certificate total amount ' + totalGCAmount * 100 + ', basket gross price ' + grossBasketAmount * 100 + ']');
  } // Log 1 cent round-off error


  if (cart.total_amount.amount !== roundedBasketAmountLessGCAmount) {
    log.error("rounding error found at pre-auth total amount validation for order id {0}, \n      bolt total amount {1} does not match with sfcc total amount {2} \n      [gift certificate total amount {3}, basket gross price {4}]", cart.order_reference, cart.total_amount.amount, (basket.totalGrossPrice.value - totalGCAmount) * 100, totalGCAmount * 100, basket.totalGrossPrice.value * 100);
  }

  return null;
}
/*
 * Exposed of methods
 * */


module.exports = {
  checkItemQuantity: checkItemQuantity,
  validateProducts: validateProducts,
  updateSelectedShippingMethod: updateSelectedShippingMethod,
  prepareBillingAddress: prepareBillingAddress,
  handleBillingAddress: handleBillingAddress,
  getGiftCertificateCode: getGiftCertificateCode,
  createOrder: createOrder,
  orderHookErrorResp: orderHookErrorResp,
  formatCreateOrderHookErrorResponse: formatCreateOrderHookErrorResponse,
  orderHookSuccessResponse: orderHookSuccessResponse,
  clearBoltData: clearBoltData,
  removeExpiredDummyOrders: removeExpiredDummyOrders,
  getBasketTotalGCAmount: getBasketTotalGCAmount,
  getBasketTotalCouponAmount: getBasketTotalCouponAmount,
  validateCartCouponAmount: validateCartCouponAmount,
  validateCartTotalAmount: validateCartTotalAmount
};