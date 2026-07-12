import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { OperatorAccessMessage } from '../../components/operator-access-message';
import { getOperatorSession } from '../../lib/operator-session';

import { LoginForm } from './login-form';

/**
 * `/login` — operator session issuance page. Not in the middleware matcher, so
 * it is reachable without a session. If the visitor already has a valid signed
 * session, redirect them to the dashboard (or the page they came from).
 */
export default async function LoginPage(): Promise<ReactNode> {
  const session = await getOperatorSession();
  if (session !== null) {
    redirect('/dashboard');
  }

  return (
    <OperatorAccessMessage title="Operator sign-in">
      <p>
        Enter the operator bootstrap token to start a signed session. The session
        cookie is HTTP-only and signed (HS256); the bootstrap token is never
        stored client-side.
      </p>
      <LoginForm />
    </OperatorAccessMessage>
  );
}
