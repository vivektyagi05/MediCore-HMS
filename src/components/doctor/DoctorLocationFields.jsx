import { useEffect } from "react";
import { useLocationOptions } from "../../hooks/useLocationOptions";
import {
  OTHER_OPTION,
  changeLevel,
  isDistrictChosen,
  selectValueFor,
  setOtherText,
} from "../../utils/doctorLocation";

const selectClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100";
const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100";
const labelClass = "mb-1 block text-xs font-bold text-slate-500";

/**
 * State (select) → District (select) → City (select), each with an explicit
 * "Other" option and free-text fallback so a locality outside the canonical
 * dataset can still be entered and saved.
 * Controlled: `value` is a location object (see utils/doctorLocation.js) and
 * `onChange` receives the next location object.
 *
 * `onStatusChange` (optional, additive): called with (loading, error)
 * booleans whenever this component's own master-data fetch state changes,
 * so a parent form (DoctorOnboarding) can block submit while location data
 * is still loading or block it after a load failure, without this
 * component needing to know anything about submission. Existing callers
 * that don't pass it (e.g. DoctorProfessionalProfile) are unaffected.
 */
export default function DoctorLocationFields({ value, onChange, disabled = false, labels = {}, onStatusChange }) {
  const options = useLocationOptions(
    value.stateType === "MASTER" ? value.stateMasterId : "",
    value.districtType === "MASTER" ? value.districtMasterId : "",
  );

  useEffect(() => {
    const loading =
      options.statesLoading ||
      (Boolean(value.stateMasterId) && options.districtsLoading) ||
      (Boolean(value.districtMasterId) && options.citiesLoading);
    const error = Boolean(options.statesError || options.districtsError || options.citiesError);
    onStatusChange?.(loading, error);
  }, [
    options.statesLoading,
    options.districtsLoading,
    options.citiesLoading,
    options.statesError,
    options.districtsError,
    options.citiesError,
    value.stateMasterId,
    value.districtMasterId,
    onStatusChange,
  ]);
  const stateIsOther = value.stateType === "OTHER";
  const districtChosen = isDistrictChosen(value);
  const cityIsOther = value.cityType === "OTHER";
  const l = { state: "State", district: "District", city: "City", ...labels };

  const pick = (level, list) => (event) => {
    const raw = event.target.value;
    if (raw === OTHER_OPTION) return onChange(changeLevel(value, level, OTHER_OPTION));
    const item = list.find((entry) => String(entry._id) === raw);
    return onChange(changeLevel(value, level, item ? { id: item._id, name: item.name } : ""));
  };

  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="doctor-location-fields">
      <label className="block">
        <span className={labelClass}>{l.state}</span>
        <select
          data-testid="location-state"
          disabled={disabled}
          value={selectValueFor(value, "state")}
          onChange={pick("state", options.states)}
          className={selectClass}
        >
          <option value="">{options.statesLoading ? "Loading states…" : "Select state"}</option>
          {options.states.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
          <option value={OTHER_OPTION}>Other</option>
        </select>
        {stateIsOther && (
          <input
            disabled={disabled}
            value={value.stateOther}
            onChange={(e) => onChange(setOtherText(value, "state", e.target.value))}
            placeholder="Other state"
            className={`mt-2 ${inputClass}`}
          />
        )}
        {options.statesError && <p role="alert" className="mt-1 text-xs text-red-600">Could not load the state list. Reload the page to retry.</p>}
        {!options.statesLoading && !options.statesError && options.states.length === 0 && (
          <p role="alert" className="mt-1 text-xs text-amber-700">The state list is empty on the server. Contact support.</p>
        )}
      </label>

      <label className="block">
        <span className={labelClass}>{l.district}</span>
        {stateIsOther ? (
          <input
            data-testid="location-district-text"
            disabled={disabled}
            value={value.districtOther}
            onChange={(e) => onChange({ ...setOtherText(value, "district", e.target.value), districtType: "OTHER" })}
            placeholder="Enter district"
            className={inputClass}
          />
        ) : (
          <>
            <select
              data-testid="location-district"
              disabled={disabled || !value.stateMasterId}
              value={selectValueFor(value, "district")}
              onChange={pick("district", options.districts)}
              className={selectClass}
            >
              <option value="">{options.districtsLoading ? "Loading districts…" : "Select district"}</option>
              {options.districts.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
              <option value={OTHER_OPTION}>Other</option>
            </select>
            {value.districtType === "OTHER" && (
              <input
                disabled={disabled}
                value={value.districtOther}
                onChange={(e) => onChange(setOtherText(value, "district", e.target.value))}
                placeholder="Other district"
                className={`mt-2 ${inputClass}`}
              />
            )}
            {options.districtsError && <p role="alert" className="mt-1 text-xs text-red-600">Could not load districts for this state.</p>}
          </>
        )}
      </label>

      <label className="block">
        <span className={labelClass}>{l.city}</span>
        {!districtChosen ? (
          <select data-testid="location-city" disabled className={selectClass}>
            <option value="">Select a district first</option>
          </select>
        ) : value.districtType === "OTHER" ? (
          <input
            data-testid="location-city-text"
            disabled={disabled}
            value={value.cityOther}
            onChange={(e) => onChange({ ...setOtherText(value, "city", e.target.value), cityType: "OTHER" })}
            placeholder="Enter city"
            className={inputClass}
          />
        ) : (
          <>
            <select
              data-testid="location-city"
              disabled={disabled}
              value={selectValueFor(value, "city")}
              onChange={pick("city", options.cities)}
              className={selectClass}
            >
              <option value="">{options.citiesLoading ? "Loading cities…" : "Select city"}</option>
              {options.cities.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
              <option value={OTHER_OPTION}>Other</option>
            </select>
            {cityIsOther && (
              <input
                disabled={disabled}
                value={value.cityOther}
                onChange={(e) => onChange(setOtherText(value, "city", e.target.value))}
                placeholder="Other city/locality"
                className={`mt-2 ${inputClass}`}
              />
            )}
            {options.citiesError && <p role="alert" className="mt-1 text-xs text-red-600">Could not load cities for this district.</p>}
          </>
        )}
      </label>
    </div>
  );
}
