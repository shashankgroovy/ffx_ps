browser.commands.onCommand.addListener((command) => {
  if (command === "switch-profile") {
    browser.browserAction.openPopup();
  }
});
