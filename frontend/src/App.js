import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Home from "./pages/Home";
import HostRoom from "./pages/HostRoom";
import PlayerRoom from "./pages/PlayerRoom";
import SpectatorRoom from "./pages/SpectatorRoom";
import "./App.css";

function App() {
  return (
    <div className="min-h-screen stage-bg text-white" dir="rtl">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/host/:code" element={<HostRoom />} />
          <Route path="/play/:code" element={<PlayerRoom />} />
          <Route path="/watch/:code" element={<SpectatorRoom />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-center" theme="dark" />
    </div>
  );
}

export default App;
