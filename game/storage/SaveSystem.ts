export interface GameSaveData {
  credits: number;
  level: number;
  xp: number;
  unlockedPlanets: number[];
  vehicleLevel: number;
  weaponLevel: number;
  settings: {
    music: boolean;
    sfx: boolean;
  };
}

const DEFAULT_SAVE: GameSaveData = {
  credits: 0,
  level: 1,
  xp: 0,
  unlockedPlanets: [1], // 1: Training, 2: Desert, 3: Forest, 4: Mountains, 5: Earth
  vehicleLevel: 1,
  weaponLevel: 1,
  settings: {
    music: true,
    sfx: true,
  }
};

export class SaveSystem {
  private static DBNAME = 'TankeelSaveDB';
  private static STORENAME = 'SaveData';

  static async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DBNAME, 1);
      
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORENAME)) {
          db.createObjectStore(this.STORENAME);
        }
      };

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject('IndexedDB Init Error');
    });
  }

  static async load(): Promise<GameSaveData> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DBNAME, 1);
      
      request.onsuccess = (event: any) => {
        const db = event.target.result;
        const tx = db.transaction(this.STORENAME, 'readonly');
        const store = tx.objectStore(this.STORENAME);
        const getReq = store.get('mainSave');

        getReq.onsuccess = () => {
          if (getReq.result) {
            resolve({ ...DEFAULT_SAVE, ...getReq.result });
          } else {
            resolve(DEFAULT_SAVE);
          }
        };
        
        getReq.onerror = () => resolve(DEFAULT_SAVE);
      };

      request.onerror = () => resolve(DEFAULT_SAVE);
    });
  }

  static async save(data: GameSaveData): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DBNAME, 1);
      
      request.onsuccess = (event: any) => {
        const db = event.target.result;
        const tx = db.transaction(this.STORENAME, 'readwrite');
        const store = tx.objectStore(this.STORENAME);
        store.put(data, 'mainSave');
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject('Save failed');
      };
    });
  }

  static async awardCredits(amount: number) {
    const data = await this.load();
    data.credits += amount;
    await this.save(data);
  }
}
