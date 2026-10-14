import { Link } from 'react-router';
import { Page } from '@/components/AppShell';
import { Button, EmptyState } from '@/components/ui';
import { t } from '@/lib/copy';

export function NotFoundPage() {
  return (
    <Page className="flex min-h-page items-center justify-center">
      <EmptyState
        title={t('error.notFound.title')}
        body={t('error.notFound.body')}
        action={
          <Link to="/">
            <Button>{t('error.notFound.cta')}</Button>
          </Link>
        }
      />
    </Page>
  );
}
