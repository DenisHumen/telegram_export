import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ConfirmRoot } from './components/ui/ConfirmRoot';
import { Toaster } from './components/ui/Toaster';
import { AccountsPage } from './pages/AccountsPage';
import { AddAccountWizard } from './pages/AddAccountWizard';
import { ChatDetailPage } from './pages/ChatDetailPage';
import { ChatsPage } from './pages/ChatsPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="accounts/new" element={<AddAccountWizard />} />
          <Route path="accounts/:id/chats" element={<ChatsPage />} />
          <Route path="chats/:chatId" element={<ChatDetailPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
      <ConfirmRoot />
    </>
  );
}
