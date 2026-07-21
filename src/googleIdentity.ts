type GoogleCredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: any;
  }
}

let identityScript: Promise<void> | null = null;

export async function renderGoogleSignIn(
  element: HTMLElement,
  clientId: string,
  locale: string,
  onCredential: (credential: string) => void,
) {
  await loadGoogleIdentity(locale);
  if (!window.google?.accounts?.id) throw new Error('Google Identity Services did not initialize.');
  element.replaceChildren();
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response: GoogleCredentialResponse) => {
      if (response.credential) onCredential(response.credential);
    },
    auto_select: false,
    cancel_on_tap_outside: true,
    use_fedcm_for_prompt: true,
  });
  window.google.accounts.id.renderButton(element, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    shape: 'rectangular',
    text: 'continue_with',
    logo_alignment: 'left',
    width: 320,
    locale,
  });
}

function loadGoogleIdentity(locale: string): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (identityScript) return identityScript;
  identityScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://accounts.google.com/gsi/client?hl=${encodeURIComponent(locale)}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Identity Services could not be loaded.'));
    document.head.append(script);
  });
  return identityScript;
}
