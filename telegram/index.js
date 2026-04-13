const state = require('./state');
const auth = require('./auth');
const categories = require('./categories');
const sizes = require('./sizes');
const brands = require('./brands');
const wizard = require('./wizard');
const review = require('./review');
const photos = require('./photos');
const posting = require('./posting');

let menuMod;

module.exports = function initTelegram({ store, vintedFetch, verifyPassword, app, db }) {

  let TelegramBot;
  try { TelegramBot = require('node-telegram-bot-api'); } catch {
    console.log('[TG] node-telegram-bot-api not installed — bot disabled');
    return;
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) { console.log('[TG] No TELEGRAM_BOT_TOKEN — bot disabled'); return; }

  const DISABLE_BACKEND_VINTED = process.env.DISABLE_BACKEND_VINTED === '1';
  if (DISABLE_BACKEND_VINTED) {
    console.log('[TG] DISABLE_BACKEND_VINTED=1 — backend will not call Vinted directly; extension handles sessions');
  }

  const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;
  let botMode = 'polling';

  const bot = new TelegramBot(BOT_TOKEN, {
    polling: { autoStart: true, params: { timeout: 30 } }
  });

  const _origSendMessage = bot.sendMessage.bind(bot);
  bot.sendMessage = async function(chatId, text, opts) {
    const result = await _origSendMessage(chatId, text, opts);
    try {
      const c = state.getChat(chatId);
      if (c && result?.message_id) {
        if (!c._sentIds) c._sentIds = [];
        c._sentIds.push(result.message_id);
        if (c._sentIds.length > 200) c._sentIds.splice(0, c._sentIds.length - 200);
      }
    } catch (_) {}
    return result;
  };

  if (WEBHOOK_URL) {
    bot.stopPolling();
    bot.setWebHook(WEBHOOK_URL);
    app.post('/api/telegram/webhook', (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
    botMode = 'webhook';
  }

  bot.on('polling_error', (err) => {
    console.error('[TG] Polling error:', err.code, err.message);
  });
  bot.on('error', (err) => {
    console.error('[TG] Error:', err.message);
  });

  bot.getMe().then((me) => {
    console.log(`[TG] Bot started (${botMode}) — @${me.username}`);
  }).catch((err) => {
    console.error('[TG] Bot token invalid or network error:', err.message);
  });

  app.get('/api/telegram/status', (req, res) => {
    res.json({ ok: true, mode: botMode, token_set: !!BOT_TOKEN, webhook: WEBHOOK_URL || null });
  });

  bot.setMyCommands([
    { command: 'start',  description: 'Welcome message & setup guide' },
    { command: 'menu',   description: 'Main menu — switch, log out, clean chat' },
    { command: 'login',  description: 'Connect your RelistPro account' },
    { command: 'switch', description: 'Switch between linked Vinted accounts' },
    { command: 'status', description: 'Check connection & Vinted session' },
    { command: 'ready',  description: 'Continue after fixing a failed step' },
    { command: 'cancel', description: 'Abort current listing' },
    { command: 'retry',  description: 'Resume a failed listing (last 5)' },
    { command: 'logout', description: 'Disconnect current account' },
    { command: 'help',   description: 'Show all commands' },
  ]).then(() => console.log('[TG] Commands menu registered'));

  const ctx = { bot, db, store, app, vintedFetch, verifyPassword, DISABLE_BACKEND_VINTED };

  state.init({ db, store, bot });
  auth.init({ bot, db, store, vintedFetch, verifyPassword, DISABLE_BACKEND_VINTED });
  categories.init({ bot, store, vintedFetch });
  sizes.init({ bot, store, vintedFetch });
  brands.init({ bot, vintedFetch, store });
  wizard.init({ bot, store, vintedFetch });
  review.init({ bot });
  photos.init({ bot, store });
  posting.init({ bot, db, store });

  menuMod = require('./menu');
  menuMod.init(ctx);

  brands.setDeps({
    wizardNext: wizard.wizardNext,
    showSummary: review.showSummary,
  });

  wizard.setDeps({
    searchCategories: categories.searchCategories,
    autoResolveCategory: categories.autoResolveCategory,
    ensureLiveCatalog: categories.ensureLiveCatalog,
    getCategories: categories.getCategories,
    autoResolveSize: sizes.autoResolveSize,
    findOneSize: sizes.findOneSize,
    showSizePicker: sizes.showSizePicker,
    searchBrands: brands.searchBrands,
    lookupVintedBrand: brands.lookupVintedBrand,
    isHighRiskBrand: brands.isHighRiskBrand,
    triggerAuthGate: brands.triggerAuthGate,
    showSummary: review.showSummary,
  });

  sizes.setCallbacks({
    wizardNext: wizard.wizardNext,
    showSummary: review.showSummary,
  });

  review.setDeps({
    showSizePicker: sizes.showSizePicker,
    showPackageSizePicker: wizard.showPackageSizePicker,
  });

  photos.setDeps({
    processPhotos: wizard.processPhotos,
    showSummary: review.showSummary,
    refreshVintedSession: auth.refreshVintedSession,
  });

  posting.setDeps({
    showSummary: review.showSummary,
  });

  if (menuMod.setDeps) {
    menuMod.setDeps({
      doLogin: auth.doLogin,
      refreshVintedSession: auth.refreshVintedSession,
      fetchVintedAccounts: auth.fetchVintedAccounts || posting.fetchVintedAccounts,
      invalidateVintedAcctCache: auth.invalidateVintedAcctCache || posting.invalidateVintedAcctCache,
      isAdminAccount: posting.isAdminAccount,
      showSummary: review.showSummary,
      enterEditStep: review.enterEditStep,
      askWizardStep: wizard.askWizardStep,
      wizardNext: wizard.wizardNext,
      proceedToReview: wizard.proceedToReview,
      promptFastBrand: wizard.promptFastBrand,
      processPhotos: wizard.processPhotos,
      showPackageSizePicker: wizard.showPackageSizePicker,
      searchCategories: categories.searchCategories,
      selectCategory: categories.selectCategory,
      searchBrands: brands.searchBrands,
      lookupVintedBrand: brands.lookupVintedBrand,
      isHighRiskBrand: brands.isHighRiskBrand,
      triggerAuthGate: brands.triggerAuthGate,
      resumeAfterAuthGate: brands.resumeAfterAuthGate,
      getProofChecklist: brands.getProofChecklist,
      stripBrandFromText: brands.stripBrandFromText,
      getUnbrandedId: brands.getUnbrandedId,
      showSizePicker: sizes.showSizePicker,
      selectSize: sizes.selectSize,
      autoResolveSize: sizes.autoResolveSize,
      selectPackageSize: wizard.selectPackageSize,
      createListing: posting.createListing,
      vintedFetch,
      verifyPassword,
    });
  }

  return bot;
};
