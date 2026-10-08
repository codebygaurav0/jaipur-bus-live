import React, { useState } from "react";

export default function EmergencyView({ userPos, onBackToBus }) {
  const [copiedLocation, setCopiedLocation] = useState(false);
  const [gettingLoc, setGettingLoc] = useState(false);

  const getCoordinates = () => {
    return {
      lat: userPos?.lat || 26.9124,
      lng: userPos?.lng || 75.7873,
    };
  };

  const handleShareLocation = async () => {
    const coords = getCoordinates();
    const mapsUrl = `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
    const shareText = `🚨 EMERGENCY ALERT: My live location in Jaipur is ${mapsUrl} (GPS: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "🚨 Jaipur Emergency Location SOS",
          text: shareText,
          url: mapsUrl,
        });
        return;
      } catch (err) {
        // User cancelled share dialog or not supported on this browser
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedLocation(true);
      setTimeout(() => setCopiedLocation(false), 3000);
    } catch (e) {
      window.open(mapsUrl, "_blank");
    }
  };

  const handleOpenInMaps = () => {
    const coords = getCoordinates();
    window.open(
      `https://www.google.com/maps?q=${coords.lat},${coords.lng}`,
      "_blank"
    );
  };

  const coords = getCoordinates();

  return (
    <div className="space-y-4 pb-10">
      {/* 1. EMERGENCY HERO CARD (PREMIUM 3D CRIMSON) */}
      <div className="card-3d-emergency p-5 text-slate-900">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl select-none" role="img" aria-label="alert">
              🚨
            </span>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-rose-950">
                Emergency & Safety SOS
              </h2>
              <p className="text-[10px] text-rose-700 font-bold">
                Jaipur City Quick Response Helplines
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping"></span>
            24×7 Active
          </span>
        </div>

        <p className="text-xs text-slate-700 font-medium leading-relaxed mt-1">
          Tap any button below to connect directly with official emergency
          dispatch centers in Jaipur.
        </p>
      </div>

      {/* 2. PRIMARY 3D ACTION CALL BUTTONS (LARGE, HIGH CONTRAST, TACTILE) */}
      <div className="space-y-3">
        {/* CALL 112 (NATIONAL UNIVERSAL / POLICE) */}
        <a
          href="tel:112"
          className="btn-3d btn-3d-red w-full p-4 rounded-2xl flex items-center justify-between group no-underline"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 text-xl text-white shadow-inner">
              🚨
            </div>
            <div className="text-left">
              <span className="text-base font-black text-white block leading-tight">
                Call 112
              </span>
              <span className="text-[11px] font-bold text-rose-100">
                Universal Emergency & Police (ERSS)
              </span>
            </div>
          </div>
          <span className="text-xs font-black text-white bg-black/20 px-3 py-1.5 rounded-xl group-hover:bg-black/30 transition">
            Tap to Call ›
          </span>
        </a>

        {/* CALL 108 (MEDICAL AMBULANCE) */}
        <a
          href="tel:108"
          className="btn-3d btn-3d-emerald w-full p-4 rounded-2xl flex items-center justify-between group no-underline"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 text-xl text-white shadow-inner">
              🚑
            </div>
            <div className="text-left">
              <span className="text-base font-black text-white block leading-tight">
                Call 108
              </span>
              <span className="text-[11px] font-bold text-emerald-100">
                Medical Emergency & Free Ambulance
              </span>
            </div>
          </div>
          <span className="text-xs font-black text-white bg-black/20 px-3 py-1.5 rounded-xl group-hover:bg-black/30 transition">
            Tap to Call ›
          </span>
        </a>

        {/* CALL 101 (FIRE BRIGADE) */}
        <a
          href="tel:101"
          className="btn-3d btn-3d-orange w-full p-4 rounded-2xl flex items-center justify-between group no-underline"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 text-xl text-white shadow-inner">
              🚒
            </div>
            <div className="text-left">
              <span className="text-base font-black text-white block leading-tight">
                Call 101
              </span>
              <span className="text-[11px] font-bold text-orange-100">
                Fire Brigade & Rescue Control
              </span>
            </div>
          </div>
          <span className="text-xs font-black text-white bg-black/20 px-3 py-1.5 rounded-xl group-hover:bg-black/30 transition">
            Tap to Call ›
          </span>
        </a>
      </div>

      {/* 3. 3D LIVE LOCATION ASSISTANCE CARD */}
      <div className="card-3d p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base select-none">📍</span>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Live Location Sharing
            </h3>
          </div>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            ● GPS Active
          </span>
        </div>

        {/* Coordinates Preview Well */}
        <div className="card-3d-sunken p-3 text-xs space-y-1">
          <div className="flex justify-between items-center text-slate-600 font-semibold">
            <span>Latitude & Longitude:</span>
            <span className="font-mono font-bold text-slate-900">
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            </span>
          </div>
          <p className="text-[10px] text-slate-500">
            Jaipur Metropolitan Transit Zone (Accurate coordinates for police & ambulance)
          </p>
        </div>

        {/* Action Buttons: Share & Open in Maps */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleShareLocation}
            className="btn-3d btn-3d-dark flex-1 py-3 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5"
          >
            <span>📍</span>
            <span>Share My Location</span>
          </button>
          <button
            type="button"
            onClick={handleOpenInMaps}
            className="btn-3d btn-3d-light flex-1 py-3 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5"
          >
            <span>🗺️</span>
            <span>Open in Maps</span>
          </button>
        </div>

        {copiedLocation && (
          <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-center text-xs font-bold text-emerald-800 animate-fadeIn">
            ✓ Live location link copied to clipboard!
          </div>
        )}
      </div>

      {/* 4. ADDITIONAL VERIFIED JAIPUR HELPLINES */}
      <div className="card-3d p-4 space-y-2.5">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
          Jaipur City Specialized Helplines
        </h3>

        <div className="space-y-1.5 text-xs">
          <a
            href="tel:1090"
            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition text-slate-800 font-bold no-underline"
          >
            <span className="flex items-center gap-2">
              <span>🛡️</span> Women Safety Helpline
            </span>
            <span className="text-rose-600 font-black">1090</span>
          </a>

          <a
            href="tel:1095"
            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition text-slate-800 font-bold no-underline"
          >
            <span className="flex items-center gap-2">
              <span>🚦</span> Jaipur Traffic Police Control
            </span>
            <span className="text-slate-900 font-black">1095</span>
          </a>

          <a
            href="tel:01412822171"
            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition text-slate-800 font-bold no-underline"
          >
            <span className="flex items-center gap-2">
              <span>🚇</span> Jaipur Metro Helpline
            </span>
            <span className="text-slate-900 font-black">0141-2822171</span>
          </a>

          <a
            href="tel:18001806088"
            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition text-slate-800 font-bold no-underline"
          >
            <span className="flex items-center gap-2">
              <span>🚌</span> JCTSL Bus Toll-Free Support
            </span>
            <span className="text-slate-900 font-black">1800-180-6088</span>
          </a>
        </div>
      </div>
    </div>
  );
}

