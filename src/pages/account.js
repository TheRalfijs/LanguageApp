import { ready } from '../main.js';
import { t, onLocaleChange } from '../i18n.js';
import { getUser, signOut } from '../auth.js';

let user = null;
const render = () => {
  document.getElementById('signed-in-as').textContent = t('account.signedInAs', { email: user.email });
};

async function init() {
  await ready;
  user = await getUser();
  if (!user) {
    location.replace(`/pages/login.html?next=${encodeURIComponent(location.pathname)}`);
    return;
  }
  render();
  onLocaleChange(render);
}

document.getElementById('sign-out').addEventListener('click', signOut);
init();
