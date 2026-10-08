import React from "react";

export default function SupportView({ onBackToBus }) {
  return (
    <div className="space-y-4 pb-10">
      {/* 1. SUPPORT JBL 3D HERO CARD */}
      <div className="card-3d p-5 text-center space-y-3">
        {/* Title */}
        <div className="flex items-center justify-center gap-2">
          <span className="text-xl select-none" role="img" aria-label="love">
            ❤️
          </span>
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            Help Us Make JBL Better
          </h2>
        </div>

        {/* Support Description */}
        <p className="text-xs text-slate-600 font-medium leading-relaxed max-w-sm mx-auto">
          Jaipur Bus Live (JBL) is an independent community initiative built to give
          every Jaipur commuter free, live JCTSL GPS bus tracking and Jaipur Metro
          journey planning.
        </p>

        {/* QR Code Prompt */}
        <p className="text-xs font-bold text-slate-800">
          Scan the QR code to support JBL.
        </p>

        {/* Uploaded QR Code Container (NO filter, NO distortion, NO crop, NO 3D transform on QR itself) */}
        <div className="flex justify-center py-2">
          <div className="card-3d-dark p-3.5 rounded-2xl inline-block shadow-xl border border-slate-700/80">
            <img
              src="/assets/jbl-support-qr.png"
              alt="Scan to support JBL"
              width="210"
              height="210"
              className="w-48 h-48 sm:w-52 sm:h-52 object-contain rounded-xl block select-none"
              loading="lazy"
            />
          </div>
        </div>

        {/* ₹1 Support Message */}
        <div className="inline-block px-3.5 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-xs font-black text-rose-700 shadow-2xs">
          Even ₹1 helps.
        </div>

        {/* Support Button */}
        <div className="pt-2">
          <a
            href="#qr-code"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="btn-3d btn-3d-red py-3 px-6 rounded-2xl text-xs font-black uppercase tracking-wider inline-flex items-center gap-2 no-underline"
          >
            <span>❤️</span>
            <span>Support JBL</span>
          </a>
        </div>
      </div>

      {/* 2. COMMUNITY BENEFITS CARD (3D LAYERED) */}
      <div className="card-3d p-4 space-y-3">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 text-center">
          What Your Contribution Powers:
        </h3>

        <div className="space-y-2 text-xs">
          <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-emerald-600 text-base font-bold shrink-0">✓</span>
            <div>
              <span className="font-bold text-slate-900 block">
                Continuous Real-Time GPS Telemetry
              </span>
              <span className="text-[11px] text-slate-500">
                Polls transmitting city fleet every 25s for 90+ active buses.
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-emerald-600 text-base font-bold shrink-0">✓</span>
            <div>
              <span className="font-bold text-slate-900 block">
                100% Ad-Free Commuter Experience
              </span>
              <span className="text-[11px] text-slate-500">
                Zero advertisements, zero tracking, instant mobile loading.
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-emerald-600 text-base font-bold shrink-0">✓</span>
            <div>
              <span className="font-bold text-slate-900 block">
                Combined Bus & Metro Transit
              </span>
              <span className="text-[11px] text-slate-500">
                Covers all 366 JCTSL stops, routes, and complete JMRC Pink Line.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

