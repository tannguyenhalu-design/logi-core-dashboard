import urllib.request
import io
import json
import traceback
import sys
import os

class NpEncoder(json.JSONEncoder):
    def default(self, obj):
        if hasattr(obj, 'item'):
            return obj.item()
        return super(NpEncoder, self).default(obj)

sys.stdout.reconfigure(encoding='utf-8')

def main():
    import pandas as pd
    import numpy as np

    url = "https://docs.google.com/spreadsheets/d/1gE2LO4jGOE6EmUIGP-jFpTSRQ-g2ge7M-PDnR_aa6g0/export?format=xlsx"
    print("Downloading Excel file...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    
    try:
        with urllib.request.urlopen(req) as response:
            data = response.read()
        print(f"Downloaded {len(data)} bytes.")
    except Exception as e:
        print("Error downloading file:", e)
        return

    flat_ltl = []
    flat_ftl = []

    # Read LTL (Raw)
    try:
        df_ltl = pd.read_excel(io.BytesIO(data), sheet_name='Raw')
        df_ltl.columns = [str(c).strip() for c in df_ltl.columns]
        
        col_month = 'created_time' if 'created_time' in df_ltl.columns else 'Month'
        col_client = 'client_name' if 'client_name' in df_ltl.columns else 'client_name'
        col_weight = 'weight' if 'weight' in df_ltl.columns else 'weight'
        col_status = 'status' if 'status' in df_ltl.columns else 'status'
        col_odr_success = 'odr_success' if 'odr_success' in df_ltl.columns else 'odr_success'
        col_loai_kho = 'warehouse_giao' if 'warehouse_giao' in df_ltl.columns else 'warehouse_giao'
        col_tinh_trang = 'Tình trạng' if 'Tình trạng' in df_ltl.columns else 'Tình trạng'

        if col_month in df_ltl.columns:
            try:
                df_ltl['parsed_date'] = pd.to_datetime(df_ltl[col_month], errors='coerce')
                df_ltl['Month'] = df_ltl['parsed_date'].dt.month.fillna(df_ltl.get('Month', 1)).astype(int)
                df_ltl['week'] = df_ltl['parsed_date'].dt.isocalendar().week.fillna(1).astype(int)
            except:
                df_ltl['Month'] = 1
                df_ltl['week'] = 1
        else:
            df_ltl['Month'] = 1
            df_ltl['week'] = 1
        
        if col_weight not in df_ltl.columns: df_ltl[col_weight] = 50
        if col_odr_success not in df_ltl.columns: df_ltl[col_odr_success] = 'ontime'
        if col_client not in df_ltl.columns: df_ltl[col_client] = 'Unknown'
        if col_loai_kho not in df_ltl.columns: df_ltl[col_loai_kho] = 'GXT'
        if col_tinh_trang not in df_ltl.columns: df_ltl[col_tinh_trang] = np.nan

        df_ltl[col_client].fillna('Unknown', inplace=True)
        df_ltl[col_loai_kho].fillna('Unknown', inplace=True)

        for _, row in df_ltl.iterrows():
            is_ontime = 1 if str(row[col_odr_success]).lower() == 'ontime' else 0
            is_broken = 1 if pd.notna(row[col_tinh_trang]) else 0
            flat_ltl.append({
                'm': int(row['Month']),
                'w': int(row['week']),
                'c': str(row[col_client]),
                'wt': float(row[col_weight]),
                'ot': is_ontime,
                'br': is_broken,
                'wh': str(row[col_loai_kho])
            })

        print("LTL logic OK.")

    except Exception as e:
        print("Error LTL:", e)
        traceback.print_exc()

    # Read FTL (Raw FTL)
    try:
        df_ftl = pd.read_excel(io.BytesIO(data), sheet_name='Raw FTL')
        df_ftl.columns = [str(c).strip() for c in df_ftl.columns]
        
        col_month = 'created_at' if 'created_at' in df_ftl.columns else df_ftl.columns[0]
        col_client = 'client_name' if 'client_name' in df_ftl.columns else 'client_name'
        col_trip = 'order_number' if 'order_number' in df_ftl.columns else 'trip_code'
        col_veh_cap = 'vehicle_capacity_value' if 'vehicle_capacity_value' in df_ftl.columns else 'vehicle_capacity_value'
        col_prov = 'ship_to_province' if 'ship_to_province' in df_ftl.columns else 'ship_to_province'
        col_loc = 'location_name' if 'location_name' in df_ftl.columns else 'location_name'
        col_weight = 'total_weight_value' if 'total_weight_value' in df_ftl.columns else 'total_weight_value'
        col_status = 'order_status' if 'order_status' in df_ftl.columns else ('trip_status' if 'trip_status' in df_ftl.columns else 'status')

        if col_month in df_ftl.columns:
            try:
                df_ftl['parsed_date'] = pd.to_datetime(df_ftl[col_month], errors='coerce')
                df_ftl['Month'] = df_ftl['parsed_date'].dt.month.fillna(4).astype(int)
                df_ftl['week'] = df_ftl['parsed_date'].dt.isocalendar().week.fillna(14).astype(int)
                df_ftl['day'] = df_ftl['parsed_date'].dt.day.fillna(1).astype(int)
            except:
                df_ftl['Month'] = 4
                df_ftl['week'] = 14
                df_ftl['day'] = 1
        else:
            df_ftl['Month'] = 4
            df_ftl['week'] = 14
            df_ftl['day'] = 1

        if col_veh_cap not in df_ftl.columns: df_ftl[col_veh_cap] = 5000
        if col_client not in df_ftl.columns: df_ftl[col_client] = 'Unknown'
        if col_prov not in df_ftl.columns: df_ftl[col_prov] = 'HCM'
        if col_loc not in df_ftl.columns: df_ftl[col_loc] = 'Loc'
        if col_weight not in df_ftl.columns: df_ftl[col_weight] = 0
        if col_status not in df_ftl.columns: df_ftl[col_status] = 'Completed'

        df_ftl[col_client].fillna('Unknown', inplace=True)
        
        for _, row in df_ftl.iterrows():
            cap = int(row[col_veh_cap]) if pd.notna(row[col_veh_cap]) else 5000
            wt = float(row[col_weight]) if pd.notna(row[col_weight]) else 0
            cap_str = '8000+' if cap >= 8000 else str(cap)
            
            st = str(row[col_status])
            if pd.isna(row[col_status]) or st.lower() == 'nan':
                st = 'Unknown'

            flat_ftl.append({
                'm': int(row['Month']),
                'w': int(row['week']),
                'd': int(row['day']),
                'c': str(row[col_client]),
                'trip': str(row[col_trip]),
                'veh': cap_str,
                'cap': cap,
                'wt': wt,
                'status': st,
                'prov': str(row[col_prov]),
                'loc': str(row[col_loc])
            })

        print("FTL logic OK.")

    except Exception as e:
        print("Error FTL:", e)
        traceback.print_exc()

    # Save to JSON
    js_content = "const FLAT_LTL = " + json.dumps(flat_ltl, ensure_ascii=False, separators=(',', ':'), cls=NpEncoder) + ";\n"
    js_content += "const FLAT_FTL = " + json.dumps(flat_ftl, ensure_ascii=False, separators=(',', ':'), cls=NpEncoder) + ";\n"
    
    with open('data.js', 'w', encoding='utf-8') as f:
        f.write(js_content)
    
    print("Dashboard data.js successfully written.")

if __name__ == "__main__":
    main()
