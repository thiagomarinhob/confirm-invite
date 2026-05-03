import { Routes, Route, Navigate } from 'react-router-dom';
import { AdminPage } from './pages/AdminPage';
import { RsvpGuestPage } from './pages/RsvpGuestPage';
import { RsvpSuccessPage } from './pages/RsvpSuccessPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AdminPage />} />
      <Route path="/rsvp/:slug" element={<RsvpGuestPage />} />
      <Route path="/rsvp/:slug/enviado" element={<RsvpSuccessPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
